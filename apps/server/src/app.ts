import './env';
import { Scalar } from '@scalar/hono-api-reference';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { describeRoute, openAPIRouteHandler, resolver } from 'hono-openapi';
import { and, asc, desc, eq, inArray, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { auth, getTrustedOrigins } from './auth';
import {
  BUTLER_BRIEFING,
  buildTurnMessage,
  extensionStageSchema,
  matchesPattern,
  newOutcomePath,
  pageContextSchema,
  reportFileBody,
} from './butler';
import { browserActionSchema } from './browser-tool';
import {
  DAEMON_SOURCE,
  DAEMON_VERSION,
  daemonAssets,
  installDaemon,
  wakeDaemon,
} from './daemon-host';
import {
  cleanupOldTurns,
  parseStarters,
  processSettle,
  sweepStaleTurn,
  type SettleVerdict,
  type TurnRow,
} from './turn-service';
import {
  getClaudeAuthStatus,
  startClaudeLogin,
  submitClaudeLoginCode,
} from './claude-auth';
import { getCodexAuthStatus, startCodexDeviceLogin } from './codex-auth';
import { getGrokAuthStatus, startGrokDeviceLogin } from './grok-auth';
import { db } from './db';
import {
  browserAction,
  extension,
  report,
  sandbox,
  task,
  turn,
  turnUpdate,
} from './db/schema';
import { getFreestyle } from './freestyle';
import { withSandboxVm } from './sandbox-heal';

/**
 * The Web Butler API. One Hono app, two runtimes: the Node dev server
 * (src/index.ts) and Cloudflare Workers (src/worker.ts). Every handler is
 * stateless — turns, browser actions, and login flows live in Postgres or
 * on the user's VM, never in server memory — which is what makes the
 * Workers deployment (free tier, no Durable Objects, no containers) work.
 */
const app = new Hono();

app.use('*', logger());

/**
 * Cookie-based sessions require credentialed CORS, which in turn requires
 * echoing the exact caller origin instead of `*`. Trusted: localhost, any
 * extension origin (ids differ per machine), and origins from the env.
 * `set-auth-token` must be exposed for the extension's bearer-token flow.
 */
const isTrustedOrigin = (origin: string) =>
  origin.startsWith('chrome-extension://') ||
  getTrustedOrigins().includes(origin);

app.use(
  '/api/*',
  cors({
    origin: (origin) => (isTrustedOrigin(origin) ? origin : null),
    credentials: true,
    exposeHeaders: ['set-auth-token'],
  }),
);

/** The URL VMs reach this server at. On Workers that's the request's own
    origin; WB_PUBLIC_URL overrides it (local dev behind a tunnel). */
function publicUrl(c: Context): string {
  return process.env.WB_PUBLIC_URL ?? new URL(c.req.url).origin;
}

/**
 * True when the sandbox daemon could never call this URL back — plain
 * local dev without a tunnel. Turns enqueued in that state would just
 * stall into "the sandbox did not pick this task up", so the enqueue
 * routes refuse up front with an actionable message instead. WB_LOCAL_VM
 * mode runs the daemon on this same machine, where loopback is exactly
 * right.
 */
function unreachableByDaemon(url: string): boolean {
  if (process.env.WB_LOCAL_VM === '1') return false;
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

const UNREACHABLE_ERROR =
  'This dev server cannot receive calls from your sandbox. Set ' +
  'WB_PUBLIC_URL to a public tunnel URL (e.g. cloudflared), or build the ' +
  'extension against the deployed API.';

/** Fire-and-forget that outlives the response on Workers (waitUntil) and
    degrades to a floating promise on Node. */
function inBackground(c: Context, work: Promise<unknown>): void {
  const guarded = work.catch((error: unknown) =>
    console.warn('[background]', error),
  );
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // Node dev server: no execution context, the promise just floats.
  }
}

const healthSchema = z.object({ ok: z.boolean() });

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullish(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const errorSchema = z.object({ error: z.string() });

app.get(
  '/health',
  describeRoute({
    description: 'Liveness probe',
    responses: {
      200: {
        description: 'Server is up',
        content: { 'application/json': { schema: resolver(healthSchema) } },
      },
    },
  }),
  (c) => c.json({ ok: true }),
);

/** Better Auth owns everything under /api/auth: sign-up, sign-in, session… */
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

/** Example guarded route — the shape every future agent endpoint follows. */
app.get(
  '/api/me',
  describeRoute({
    description: 'Current authenticated user, from the session cookie',
    responses: {
      200: {
        description: 'The signed-in user',
        content: {
          'application/json': {
            schema: resolver(z.object({ user: userSchema })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ user: session.user });
  },
);

const initResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    isAnonymous: z.boolean(),
  }),
  sandbox: z.object({
    vmId: z.string(),
    /** True when this call created the VM (first initialization). */
    created: z.boolean(),
  }),
});

/**
 * Idempotent first-run initialization: ensures the signed-in user (usually
 * a fresh anonymous one) has a Freestyle VM, creating it on first call.
 * The daemon (config + scripts) is installed alongside so the first prompt
 * doesn't pay the install.
 */
app.post(
  '/api/init',
  describeRoute({
    description:
      "Ensure the session's user has a sandbox VM, creating one if needed",
    responses: {
      200: {
        description: 'The user and their sandbox',
        content: {
          'application/json': { schema: resolver(initResponseSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      502: {
        description: 'Sandbox provisioning failed',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const userId = session.user.id;

    const existing = await db.query.sandbox.findFirst({
      where: eq(sandbox.userId, userId),
    });
    if (existing) {
      return c.json({
        user: { id: userId, isAnonymous: session.user.isAnonymous ?? false },
        sandbox: { vmId: existing.vmId, created: false },
      });
    }

    let vmId: string;
    if (process.env.WB_LOCAL_VM === '1') {
      // Local e2e mode: no Freestyle — the probe runs the daemon here.
      vmId = `local-${crypto.randomUUID()}`;
    } else {
      try {
        // Built by scripts/build-snapshot.ts — agent CLIs preinstalled.
        ({ vmId } = await getFreestyle().vms.create({
          snapshotId: process.env.FREESTYLE_SNAPSHOT_ID ?? null,
        }));
      } catch (error) {
        console.error('[init] freestyle vm create failed:', error);
        return c.json({ error: 'Sandbox provisioning failed' }, 502);
      }
    }

    // Two concurrent inits can both create a VM; the primary key makes the
    // first insert win and the loser's VM is deleted rather than leaked.
    const daemonToken = crypto.randomUUID();
    const inserted = await db
      .insert(sandbox)
      .values({ userId, vmId, daemonToken })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      if (!vmId.startsWith('local-')) {
        void getFreestyle()
          .vms.delete({ vmId })
          .catch(() => {});
      }
      const winner = await db.query.sandbox.findFirst({
        where: eq(sandbox.userId, userId),
      });
      return c.json({
        user: { id: userId, isAnonymous: session.user.isAnonymous ?? false },
        sandbox: { vmId: winner!.vmId, created: false },
      });
    }

    // Best-effort daemon install; the first prompt's wake self-heals a miss.
    inBackground(c, installDaemon(vmId, publicUrl(c), daemonToken));

    return c.json({
      user: { id: userId, isAnonymous: session.user.isAnonymous ?? false },
      sandbox: { vmId, created: true },
    });
  },
);

/** Shared by every provider's device-auth endpoints (codex, grok). */
const providerStatusSchema = z.object({
  status: z.enum(['connected', 'pending', 'disconnected', 'failed', 'expired']),
  /** One-time code the user enters on the verification page (pending only). */
  userCode: z.string().optional(),
  /** Where the user signs in and enters the code (pending only). */
  verificationUrl: z.string().optional(),
  /** When the pending code expires (ms epoch) — drives countdown UI. */
  expiresAt: z.number().optional(),
  error: z.string().optional(),
});

/** Session → the user's sandbox VM id, or null when either is missing. */
async function sandboxVmIdForSession(
  headers: Headers,
): Promise<
  { vmId: string; userId: string } | { error: 'unauthorized' | 'no-sandbox' }
> {
  const session = await auth.api.getSession({ headers });
  if (!session) return { error: 'unauthorized' };
  const row = await db.query.sandbox.findFirst({
    where: eq(sandbox.userId, session.user.id),
  });
  if (!row) return { error: 'no-sandbox' };
  return { vmId: row.vmId, userId: session.user.id };
}

/**
 * What a status endpoint says when the sandbox can't answer even after
 * healing. Returned as a 200 `failed` state (not a raw 500) so the
 * extension shows a truthful, retryable message instead of concluding the
 * server itself is unreachable.
 */
const SANDBOX_DOWN = {
  status: 'failed',
  error: 'The sandbox is unavailable right now',
} as const;

/**
 * Codex onboarding: start a ChatGPT device-code login on the user's VM.
 * Responds with the code to show the user; completion is polled via the
 * status endpoint. Calling again abandons the previous attempt.
 */
app.post(
  '/api/providers/codex/login/start',
  describeRoute({
    description:
      "Start a Codex device-code login on the user's sandbox VM " +
      '(returns the code + URL for the user to complete in a browser)',
    responses: {
      200: {
        description: 'Device code issued; status will be `pending`',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      502: {
        description: 'The VM could not produce a device code',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    try {
      return c.json(
        await withSandboxVm(result.userId, result.vmId, startCodexDeviceLogin),
      );
    } catch (error) {
      console.error('[codex] device login start failed:', error);
      // OpenAI rate-limits device-code minting per network; tell the user
      // it's temporary instead of a generic failure.
      const message = String(error);
      return c.json(
        {
          error: message.includes('429')
            ? 'OpenAI is rate-limiting sign-ins right now. Wait a minute and try again.'
            : 'Could not start the device login',
        },
        502,
      );
    }
  },
);

app.get(
  '/api/providers/codex/status',
  describeRoute({
    description:
      "Codex auth state on the user's sandbox VM (poll while `pending`)",
    responses: {
      200: {
        description: 'Current auth status',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    try {
      return c.json(
        await withSandboxVm(result.userId, result.vmId, getCodexAuthStatus),
      );
    } catch (error) {
      console.error('[codex] status check failed:', error);
      return c.json(SANDBOX_DOWN);
    }
  },
);

/**
 * Grok onboarding: same device-code shape as codex, but driven by parsing
 * `grok login --device-auth` output on the VM (no app-server to talk to).
 */
app.post(
  '/api/providers/grok/login/start',
  describeRoute({
    description:
      "Start a Grok device-code login on the user's sandbox VM " +
      '(returns the code + URL for the user to complete in a browser)',
    responses: {
      200: {
        description: 'Device code issued; status will be `pending`',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      502: {
        description: 'The VM could not produce a device code',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    try {
      return c.json(
        await withSandboxVm(result.userId, result.vmId, startGrokDeviceLogin),
      );
    } catch (error) {
      console.error('[grok] device login start failed:', error);
      // x.ai rate-limits code minting too ("slow_down" / HTTP 429).
      const message = String(error);
      return c.json(
        {
          error:
            message.includes('429') || message.includes('slow_down')
              ? 'x.ai is rate-limiting sign-ins right now. Wait a minute and try again.'
              : 'Could not start the device login',
        },
        502,
      );
    }
  },
);

app.get(
  '/api/providers/grok/status',
  describeRoute({
    description:
      "Grok auth state on the user's sandbox VM (poll while `pending`)",
    responses: {
      200: {
        description: 'Current auth status',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    try {
      return c.json(
        await withSandboxVm(result.userId, result.vmId, getGrokAuthStatus),
      );
    } catch (error) {
      console.error('[grok] status check failed:', error);
      return c.json(SANDBOX_DOWN);
    }
  },
);

/**
 * Claude onboarding: a *reverse* device flow. Start returns a sign-in URL
 * (no user code); the user pastes the code Anthropic gives them back via
 * the /login/code endpoint, and status flips to connected once the CLI on
 * the VM finishes the exchange.
 */
app.post(
  '/api/providers/claude/login/start',
  describeRoute({
    description:
      "Start a Claude Code login on the user's sandbox VM " +
      '(returns the sign-in URL; the user pastes the resulting code back)',
    responses: {
      200: {
        description: 'Sign-in URL issued; status will be `pending`',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      502: {
        description: 'The VM could not produce a sign-in link',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    try {
      return c.json(
        await withSandboxVm(result.userId, result.vmId, startClaudeLogin),
      );
    } catch (error) {
      console.error('[claude] login start failed:', error);
      return c.json({ error: 'Could not start the sign-in' }, 502);
    }
  },
);

app.post(
  '/api/providers/claude/login/code',
  describeRoute({
    description:
      "Submit the code Anthropic showed the user, forwarded to the CLI on the user's VM",
    responses: {
      200: {
        description: 'Code forwarded; keep polling status',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      400: {
        description: 'Missing code',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    const body = await c.req.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) return c.json({ error: 'Missing code' }, 400);
    return c.json(
      await withSandboxVm(result.userId, result.vmId, (vmId) =>
        submitClaudeLoginCode(vmId, code),
      ),
    );
  },
);

app.get(
  '/api/providers/claude/status',
  describeRoute({
    description:
      "Claude auth state on the user's sandbox VM (poll while `pending`)",
    responses: {
      200: {
        description: 'Current auth status',
        content: {
          'application/json': { schema: resolver(providerStatusSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    try {
      return c.json(
        await withSandboxVm(result.userId, result.vmId, getClaudeAuthStatus),
      );
    } catch (error) {
      console.error('[claude] status check failed:', error);
      return c.json(SANDBOX_DOWN);
    }
  },
);

// ---------------------------------------------------------------------------
// Tasks: the user's activity history. The extension's background upserts a
// row when a run starts and again when it settles; on startup it hydrates
// its session cache from the list. That's what carries history across
// browser restarts.
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['tab', 'global']),
  prompt: z.string(),
  url: z.string(),
  status: z.enum(['running', 'done', 'failed', 'stopped']),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  outcome: z.string().optional(),
  reportId: z.string().optional(),
  extensionId: z.string().optional(),
  seen: z.boolean(),
  /** The streamed activity feed, sent once when the task settles. Capped
      hard so a hostile client can't stuff megabytes into one row. Beyond
      the prose kinds: 'browser' rows mirror ghost-cursor acts, and the
      answer/report/extension/highlights entries are the settle-time
      results the side panel renders as cards and chips. */
  updates: z
    .array(
      z.object({
        at: z.number(),
        kind: z.enum([
          'thought',
          'message',
          'tool',
          'user',
          'browser',
          'answer',
          'report',
          'extension',
          'highlights',
        ]),
        text: z.string().max(20_000),
        /** kind 'browser': the verb, for iconography. */
        verb: z.string().max(40).optional(),
        /** kind 'report' | 'extension': the secondary description line. */
        detail: z.string().max(2_000).optional(),
        /** kind 'highlights': marker chips (id + pill label). */
        marks: z
          .array(
            z.object({
              id: z.string().max(60),
              label: z.string().max(60),
            }),
          )
          .max(8)
          .optional(),
      }),
    )
    .max(250)
    .optional(),
  /** "Suggested next" chips offered when the task settled. */
  suggestions: z.array(z.string().max(200)).max(5).optional(),
});

const TASKS_LIMIT = 100;

app.get(
  '/api/tasks',
  describeRoute({
    description: "The user's task history, newest first (capped at 100)",
    responses: {
      200: {
        description: 'Task list',
        content: {
          'application/json': { schema: resolver(z.array(taskSchema)) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const rows = await db.query.task.findMany({
      where: eq(task.userId, session.user.id),
      orderBy: [desc(task.startedAt)],
      limit: TASKS_LIMIT,
    });
    // Nulls out, the wire shape is the extension's Task (optionals).
    return c.json(
      rows.map(
        ({
          userId: _userId,
          finishedAt,
          outcome,
          reportId,
          extensionId,
          updates,
          suggestions,
          ...row
        }) => ({
          ...row,
          finishedAt: finishedAt ?? undefined,
          outcome: outcome ?? undefined,
          reportId: reportId ?? undefined,
          extensionId: extensionId ?? undefined,
          updates: updates ?? undefined,
          suggestions: suggestions ?? undefined,
        }),
      ),
    );
  },
);

app.post(
  '/api/tasks',
  describeRoute({
    description:
      'Upsert one task (create on run start, update again when it settles)',
    responses: {
      200: {
        description: 'Stored',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      400: {
        description: 'Malformed task',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const body = taskSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Malformed task' }, 400);
    const values = { ...body.data, userId: session.user.id };
    await db
      .insert(task)
      .values(values)
      .onConflictDoUpdate({
        target: task.id,
        set: values,
        // Never let one user overwrite another's row via a guessed id.
        setWhere: eq(task.userId, session.user.id),
      });
    return c.json({ ok: true });
  },
);

app.post(
  '/api/tasks/seen',
  describeRoute({
    description: "Mark all of the user's tasks seen (badge reset)",
    responses: {
      200: {
        description: 'Marked',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    await db
      .update(task)
      .set({ seen: true })
      .where(and(eq(task.userId, session.user.id), eq(task.seen, false)));
    return c.json({ ok: true });
  },
);

app.delete(
  '/api/tasks/all',
  describeRoute({
    description:
      "Bulk-delete the user's tasks. ?mode=settled leaves running rows; " +
      'the default clears everything.',
    responses: {
      200: {
        description: 'Deleted',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const mine = eq(task.userId, session.user.id);
    await db
      .delete(task)
      .where(
        c.req.query('mode') === 'settled'
          ? and(mine, ne(task.status, 'running'))
          : mine,
      );
    return c.json({ ok: true });
  },
);

app.delete(
  '/api/tasks/:id',
  describeRoute({
    description: 'Delete one task from the history',
    responses: {
      200: {
        description: 'Deleted (idempotent: also for ids already gone)',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    await db
      .delete(task)
      .where(
        and(eq(task.id, c.req.param('id')), eq(task.userId, session.user.id)),
      );
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Reports: long-form artifacts the agent produced. Same contract as tasks:
// the extension's background writes on publish and hydrates its session
// cache from the list on startup — that's what keeps the Artifacts view
// (and old tasks' report links) alive across browser restarts.
// ---------------------------------------------------------------------------

const reportSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  meta: z.string().optional(),
  /** Full markdown body. Capped so a hostile client can't stuff the row. */
  text: z.string().max(500_000),
  createdAt: z.number(),
});

const REPORTS_LIMIT = 50;

app.get(
  '/api/reports',
  describeRoute({
    description: "The user's reports, newest first (capped at 50)",
    responses: {
      200: {
        description: 'Report list',
        content: {
          'application/json': { schema: resolver(z.array(reportSchema)) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const rows = await db.query.report.findMany({
      where: eq(report.userId, session.user.id),
      orderBy: [desc(report.createdAt)],
      limit: REPORTS_LIMIT,
    });
    // Nulls out, the wire shape is the extension's Report (optionals).
    return c.json(
      rows.map(({ userId: _userId, meta, ...row }) => ({
        ...row,
        meta: meta ?? undefined,
      })),
    );
  },
);

app.post(
  '/api/reports',
  describeRoute({
    description: 'Store one report (published when an artifact outcome lands)',
    responses: {
      200: {
        description: 'Stored',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      400: {
        description: 'Malformed report',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const body = reportSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Malformed report' }, 400);
    const values = { ...body.data, userId: session.user.id };
    await db
      .insert(report)
      .values(values)
      .onConflictDoUpdate({
        target: report.id,
        set: values,
        // Never let one user overwrite another's row via a guessed id.
        setWhere: eq(report.userId, session.user.id),
      });
    return c.json({ ok: true });
  },
);

app.delete(
  '/api/reports/all',
  describeRoute({
    description: "Delete every one of the user's reports",
    responses: {
      200: {
        description: 'Deleted',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    await db.delete(report).where(eq(report.userId, session.user.id));
    return c.json({ ok: true });
  },
);

app.delete(
  '/api/reports/:id',
  describeRoute({
    description: 'Delete one report',
    responses: {
      200: {
        description: 'Deleted (idempotent: also for ids already gone)',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    await db
      .delete(report)
      .where(
        and(
          eq(report.id, c.req.param('id')),
          eq(report.userId, session.user.id),
        ),
      );
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Site extensions: persistent page modifications authored by the agent
// (`extension` outcomes, stored by the settle processing in
// turn-service.ts). The browser extension mirrors these into
// chrome.userScripts registrations; these routes serve that sync plus the
// user-facing toggle/delete controls.
// ---------------------------------------------------------------------------

const siteExtensionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  urlPatterns: z.array(z.string()),
  script: z.string(),
  stage: extensionStageSchema,
  enabled: z.boolean(),
  version: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** DB row → wire shape (drops userId/taskId provenance). */
function extensionWire(row: typeof extension.$inferSelect) {
  const { userId: _userId, taskId: _taskId, ...wire } = row;
  return wire;
}

app.get(
  '/api/extensions',
  describeRoute({
    description: "All of the user's site extensions, enabled or not",
    responses: {
      200: {
        description: 'Extension list',
        content: {
          'application/json': {
            schema: resolver(z.array(siteExtensionSchema)),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const rows = await db.query.extension.findMany({
      where: eq(extension.userId, session.user.id),
      orderBy: [desc(extension.createdAt)],
    });
    return c.json(rows.map(extensionWire));
  },
);

app.patch(
  '/api/extensions/:id',
  describeRoute({
    description: 'Toggle a site extension on or off',
    responses: {
      200: {
        description: 'The updated extension',
        content: {
          'application/json': { schema: resolver(siteExtensionSchema) },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      404: {
        description: 'No such extension',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const body = z
      .object({ enabled: z.boolean() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'enabled is required' }, 400);
    const [row] = await db
      .update(extension)
      .set({ enabled: body.data.enabled, updatedAt: Date.now() })
      .where(
        and(
          eq(extension.id, c.req.param('id')),
          eq(extension.userId, session.user.id),
        ),
      )
      .returning();
    if (!row) return c.json({ error: 'No such extension' }, 404);
    return c.json(extensionWire(row));
  },
);

app.delete(
  '/api/extensions/:id',
  describeRoute({
    description: 'Delete a site extension',
    responses: {
      200: {
        description: 'Deleted',
        content: {
          'application/json': {
            schema: resolver(z.object({ ok: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    await db
      .delete(extension)
      .where(
        and(
          eq(extension.id, c.req.param('id')),
          eq(extension.userId, session.user.id),
        ),
      );
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Agent turns. A turn is a ROW, not a request: POST /api/agent/prompt
// enqueues it and wakes the VM daemon, the daemon executes it against the
// agent CLI and streams updates back through /api/daemon/sync, and the
// extension polls GET /api/agent/turn/:id until the row settles. Nothing
// is lost when the extension's service worker is recycled or this server
// scales to zero — both sides just resume polling.
// ---------------------------------------------------------------------------

const agentPromptSchema = z.object({
  provider: z.enum(['codex', 'grok', 'claude']),
  prompt: z.string().min(1),
  /** Where the user was: URL, title, HTML snapshot, selected elements. */
  page: pageContextSchema.optional(),
  /** The run's task id — provenance for extensions authored this turn. */
  taskId: z.string().optional(),
  /** The user's open tabs at send time — envelope context + browser-control
      stage. Capped so a hostile client can't bloat the turn. */
  openTabs: z
    .array(
      z.object({
        title: z.string().max(300),
        url: z.string().max(2000),
        active: z.boolean(),
      }),
    )
    .max(50)
    .optional(),
  /** The answer open on the user's screen when they sent this message —
      what "this"/"that" most likely refers to. Clipped by the client;
      capped here so a hostile one can't bloat the turn. */
  openAnswer: z
    .object({
      prompt: z.string().max(1000),
      tier: z.enum(['answer', 'artifact']),
      title: z.string().max(300).optional(),
      text: z.string().max(10_000),
    })
    .optional(),
});

app.post(
  '/api/agent/prompt',
  describeRoute({
    description:
      'Enqueue one agent turn for the VM daemon and wake it; returns the ' +
      'turn id to poll with GET /api/agent/turn/:id',
    responses: {
      200: {
        description: 'Turn enqueued',
        content: { 'application/json': {} },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    const body = agentPromptSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json({ error: 'provider and prompt are required' }, 400);
    }
    const { provider, prompt, page, taskId, openTabs, openAnswer } = body.data;
    const userId = result.userId;

    // Cross-conversation context for the envelope: the full extension
    // inventory (page matches marked), other runs still in flight, and a
    // deeper slice of settled history.
    const notThisRun = taskId
      ? and(eq(task.userId, userId), ne(task.id, taskId))
      : eq(task.userId, userId);
    const [allExtensions, ongoingTaskRows, recentTaskRows, reportRows] =
      await Promise.all([
        db.query.extension.findMany({
          where: eq(extension.userId, userId),
          orderBy: [desc(extension.updatedAt)],
          limit: 30,
        }),
        db.query.task.findMany({
          where: and(notThisRun, eq(task.status, 'running')),
          orderBy: [desc(task.startedAt)],
          limit: 10,
        }),
        db.query.task.findMany({
          where: and(notThisRun, ne(task.status, 'running')),
          orderBy: [desc(task.startedAt)],
          limit: 15,
        }),
        db.query.report.findMany({
          where: eq(report.userId, userId),
          orderBy: [desc(report.createdAt)],
          limit: 12,
        }),
      ]);

    // The turn's first VM touch is the daemon wake, so it doubles as the
    // heal point: a deleted VM gets replaced here and the turn row is
    // written against the fresh one.
    const serverUrl = publicUrl(c);
    if (unreachableByDaemon(serverUrl)) {
      return c.json({ error: UNREACHABLE_ERROR }, 503);
    }
    let vmId: string;
    try {
      vmId = await withSandboxVm(userId, result.vmId, async (id) => {
        await wakeDaemon(userId, id, serverUrl);
        return id;
      });
    } catch (error) {
      console.error('[agent] daemon wake failed:', error);
      return c.json({ error: 'The sandbox is unavailable right now' }, 502);
    }

    const clip = (text: string, max: number) =>
      text.length > max ? `${text.slice(0, max - 3)}…` : text;

    const outcomePath = newOutcomePath();
    const message = buildTurnMessage(prompt, page, outcomePath, {
      extensions: allExtensions.map((ext) => ({
        id: ext.id,
        name: ext.name,
        description: ext.description,
        urlPatterns: ext.urlPatterns,
        version: ext.version,
        enabled: ext.enabled,
        onPage:
          page != null &&
          ext.urlPatterns.some((pattern) => matchesPattern(pattern, page.url)),
      })),
      ongoingTasks: ongoingTaskRows.map((row) => ({
        prompt: clip(row.prompt, 200),
        startedAt: row.startedAt,
        url: row.url,
      })),
      // Clips sized so history is genuinely useful for follow-ups ("that
      // thing from earlier") without letting one verbose task eat the turn.
      recentTasks: recentTaskRows.map((row) => ({
        prompt: clip(row.prompt, 200),
        status: row.status,
        outcome: row.outcome ? clip(row.outcome, 400) : undefined,
        produced: row.reportId
          ? ('artifact' as const)
          : row.extensionId
            ? ('extension' as const)
            : undefined,
        finishedAt: row.finishedAt ?? undefined,
        url: row.url,
      })),
      openTabs: openTabs?.map((tab) => ({
        title: clip(tab.title, 120),
        url: tab.url,
        active: tab.active,
      })),
      openAnswer,
      reports: reportRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: clip(row.description, 200),
        createdAt: row.createdAt,
      })),
    });

    const turnId = crypto.randomUUID();
    await db.insert(turn).values({
      id: turnId,
      userId,
      taskId,
      vmId,
      provider,
      kind: 'task',
      status: 'queued',
      message,
      preamble: BUTLER_BRIEFING,
      outcomePath,
      contextManifest: [
        ...allExtensions.map((ext) => ({
          kind: 'extension' as const,
          id: ext.id,
          version: ext.version,
        })),
        ...reportRows.map((row) => ({
          kind: 'report' as const,
          id: row.id,
          version: 1,
        })),
      ],
      agentCommand: process.env.WB_FAKE_AGENT_CMD || null,
      createdAt: Date.now(),
      wakeAt: Date.now(),
    });

    inBackground(c, cleanupOldTurns(userId));

    return c.json({ turn: turnId });
  },
);

/** One turn-update batch on the wire. */
const turnPollResponse = (
  row: TurnRow,
  updates: Array<{ seq: number; updates: Record<string, unknown>[] }>,
  actions: unknown[],
) => ({
  status: row.status,
  updates,
  actions,
  ...(row.status === 'done' || row.status === 'cancelled'
    ? {
        text: row.reply ?? '',
        stopReason: row.stopReason ?? 'end_turn',
        outcomes: row.outcomes ?? undefined,
        suggestions: row.suggestions ?? undefined,
        highlights: row.highlights ?? undefined,
      }
    : {}),
  ...(row.status === 'failed'
    ? { error: row.error ?? 'agent turn failed' }
    : {}),
});

app.get(
  '/api/agent/turn/:id',
  describeRoute({
    description:
      "Poll one turn: update batches after ?since, the turn's pending " +
      'browser actions, and the terminal payload once it settles',
    responses: {
      200: {
        description: 'Turn state',
        content: { 'application/json': {} },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      404: {
        description: 'No such turn (settled long ago and swept, or never existed)',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const since = Number(c.req.query('since') ?? '0') || 0;
    let row = await db.query.turn.findFirst({
      where: and(
        eq(turn.id, c.req.param('id')),
        eq(turn.userId, session.user.id),
      ),
    });
    if (!row) return c.json({ error: 'no such turn' }, 404);

    if (row.status === 'queued' || row.status === 'running') {
      row = await sweepStaleTurn(row);
      // A queued turn nobody picked up yet: nudge the daemon again, at
      // most every 25s (the first wake may have raced the VM's boot).
      if (row.status === 'queued' && Date.now() - (row.wakeAt ?? 0) > 25_000) {
        const [claimed] = await db
          .update(turn)
          .set({ wakeAt: Date.now() })
          .where(and(eq(turn.id, row.id), eq(turn.status, 'queued')))
          .returning();
        if (claimed) {
          inBackground(
            c,
            wakeDaemon(session.user.id, row.vmId, publicUrl(c)),
          );
        }
      }
    }

    const [updates, actions] = await Promise.all([
      db.query.turnUpdate.findMany({
        where: and(eq(turnUpdate.turnId, row.id), gt(turnUpdate.seq, since)),
        orderBy: [asc(turnUpdate.seq)],
        limit: 200,
      }),
      row.status === 'running'
        ? db.query.browserAction.findMany({
            where: and(
              eq(browserAction.turnId, row.id),
              eq(browserAction.status, 'pending'),
            ),
            orderBy: [asc(browserAction.createdAt)],
          })
        : Promise.resolve([]),
    ]);

    return c.json(
      turnPollResponse(
        row,
        updates.map((batch) => ({ seq: batch.seq, updates: batch.updates })),
        actions.map((action) => action.request),
      ),
    );
  },
);

/**
 * Explicitly cancel a task's turns. Queued turns die immediately; running
 * ones get cancelRequested, which the daemon translates into an ACP
 * session/cancel on its next sync.
 */
app.post(
  '/api/agent/cancel',
  describeRoute({
    description: 'Cancel every pending or running turn belonging to a task',
    responses: {
      200: {
        description: 'Cancel signalled (idempotent)',
        content: { 'application/json': { schema: resolver(healthSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const body = z
      .object({ taskId: z.string() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'taskId is required' }, 400);
    const mine = and(
      eq(turn.userId, session.user.id),
      eq(turn.taskId, body.data.taskId),
    );
    await db
      .update(turn)
      .set({ status: 'cancelled', finishedAt: Date.now() })
      .where(and(mine, eq(turn.status, 'queued')));
    await db
      .update(turn)
      .set({ cancelRequested: true })
      .where(and(mine, eq(turn.status, 'running')));
    return c.json({ ok: true });
  },
);

/**
 * The extension's answer to one browser action. Stored on the row; the
 * daemon collects it on its next sync and writes the VM response file that
 * unblocks the `browser` CLI.
 */
const actionResultSchema = z.object({
  id: z.string().min(1),
  result: z.union([
    z.object({ ok: z.literal(true), data: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

app.post(
  '/api/agent/action-result',
  describeRoute({
    description: "Deliver a browser action's result back to the waiting turn",
    responses: {
      200: {
        description: 'Delivered (or the action was no longer pending)',
        content: {
          'application/json': {
            schema: resolver(z.object({ delivered: z.boolean() })),
          },
        },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const body = actionResultSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'Malformed result' }, 400);
    const updated = await db
      .update(browserAction)
      .set({
        result: body.data.result,
        status: 'done',
        resolvedAt: Date.now(),
      })
      .where(
        and(
          eq(browserAction.id, body.data.id),
          eq(browserAction.userId, session.user.id),
          eq(browserAction.status, 'pending'),
        ),
      )
      .returning({ id: browserAction.id });
    return c.json({ delivered: updated.length > 0 });
  },
);

// --- Page starters -----------------------------------------------------------
// Small, page-specific prompt suggestions for the empty prompt box,
// generated by the user's own AI. They ride the same turn queue as real
// tasks (kind 'starters'); results are cached per (user, page) as settled
// rows so browsing back and forth doesn't re-bill the user's plan.

const STARTERS_PREAMBLE = `You generate starter prompts for Web Butler, a browser assistant that can answer questions about the page, dig into details, compare options, fill forms, write reports, and install persistent page modifications.

Each message gives you one web page: URL, title, and a text extract. Reply with ONLY a JSON array of 0 to 3 strings — no prose, no markdown fence, nothing else.

Most pages deserve NOTHING. An empty array is the normal answer for app shells, home pages, feeds, dashboards, search pages, and anything the user is just using rather than studying — a person on Apple Music doesn't need "What music does Apple Music have?", and a person on their inbox doesn't need "Summarize my email". Only suggest something when the page gives you a genuinely useful move: a specific thing worth digging into, comparing, extracting, drafting from, or permanently fixing. The bar for each suggestion: a real person would tap it and be glad they did. One great suggestion beats three plausible ones; zero beats one mediocre one.

Each suggestion must be:
- specific to THIS page: name the actual product, article, repo, form, or topic
- real work Web Butler can do from here that saves the user effort — never a question the page itself already answers at a glance
- short: under 56 characters
- phrased as a request or question, no trailing period

When the extract notes ad/sponsored noise, a persistent cleanup is a good suggestion, e.g. "Hide the ads on this site" or "Clean up the sponsored posts here" — Web Butler installs those as page extensions that stick.

Never output generic filler like "What is this page about?" or "Summarize this page" — when in doubt, return [].`;

const STARTERS_TTL_MS = 60 * 60 * 1000;

function startersCacheKey(userId: string, url: string): string {
  try {
    const u = new URL(url);
    // The hash is client-side view state, not a different page.
    return `${userId}:${u.origin}${u.pathname}${u.search}`;
  } catch {
    return `${userId}:${url}`;
  }
}

const agentSuggestSchema = z.object({
  provider: z.enum(['codex', 'grok', 'claude']),
  url: z.string().max(2000),
  title: z.string().max(300),
  /** Compact page digest built by the extension: description, headings,
      leading text. Capped — this is a hint, not the page snapshot. */
  signal: z.string().max(4000),
});

app.post(
  '/api/agent/suggest',
  describeRoute({
    description:
      'Request page-specific starter prompts. Returns {starters} when ' +
      'cached, or {pending, turn} to poll at GET /api/agent/suggest/:id.',
    responses: {
      200: {
        description: 'Starters, or a pending turn id',
        content: { 'application/json': {} },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      409: {
        description: 'User has no sandbox yet. Call /api/init first',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await sandboxVmIdForSession(c.req.raw.headers);
    if ('error' in result) {
      return result.error === 'unauthorized'
        ? c.json({ error: 'Unauthorized' }, 401)
        : c.json({ error: 'No sandbox. Initialize first.' }, 409);
    }
    const body = agentSuggestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json({ error: 'provider, url, title, signal are required' }, 400);
    }
    const { provider, url, title, signal } = body.data;

    // Starters are decoration — when the daemon can't call back (plain
    // local dev), just serve none instead of queuing a turn that stalls.
    if (unreachableByDaemon(publicUrl(c))) {
      return c.json({ starters: [] });
    }

    const key = startersCacheKey(result.userId, url);
    const recent = await db.query.turn.findFirst({
      where: and(eq(turn.cacheKey, key), eq(turn.userId, result.userId)),
      orderBy: [desc(turn.createdAt)],
    });
    if (recent) {
      const age = Date.now() - recent.createdAt;
      if (recent.status === 'done' && age < STARTERS_TTL_MS) {
        return c.json({ starters: recent.suggestions ?? [] });
      }
      if (
        (recent.status === 'queued' || recent.status === 'running') &&
        age < 2 * 60_000
      ) {
        return c.json({ pending: true, turn: recent.id });
      }
      // Failed or stale-cached: fall through and generate fresh.
      if (recent.status !== 'done' && age < 5 * 60_000 && recent.error) {
        // A very recent failure (provider signed out, sandbox down): don't
        // hammer the VM for decoration.
        return c.json({ starters: [] });
      }
    }

    const turnId = crypto.randomUUID();
    await db.insert(turn).values({
      id: turnId,
      userId: result.userId,
      vmId: result.vmId,
      provider,
      kind: 'starters',
      status: 'queued',
      message: `Page: ${url}\nTitle: ${title}\n\nExtract:\n${signal}`,
      preamble: STARTERS_PREAMBLE,
      outcomePath: newOutcomePath(),
      cacheKey: key,
      agentCommand: process.env.WB_FAKE_AGENT_CMD || null,
      createdAt: Date.now(),
      wakeAt: Date.now(),
    });
    // Starters are decoration: the wake rides in the background so the
    // response is immediate, and any failure just means no chips.
    inBackground(
      c,
      withSandboxVm(result.userId, result.vmId, (id) =>
        wakeDaemon(result.userId, id, publicUrl(c)),
      ),
    );
    return c.json({ pending: true, turn: turnId });
  },
);

app.get(
  '/api/agent/suggest/:id',
  describeRoute({
    description: 'Poll a pending starters turn',
    responses: {
      200: {
        description: '{pending} while generating, then {starters}',
        content: { 'application/json': {} },
      },
      401: {
        description: 'No valid session',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    let row = await db.query.turn.findFirst({
      where: and(
        eq(turn.id, c.req.param('id')),
        eq(turn.userId, session.user.id),
        eq(turn.kind, 'starters'),
      ),
    });
    if (!row) return c.json({ starters: [] });
    if (row.status === 'queued' || row.status === 'running') {
      row = await sweepStaleTurn(row);
    }
    if (row.status === 'queued' || row.status === 'running') {
      return c.json({ pending: true, turn: row.id });
    }
    return c.json({
      starters: row.status === 'done' ? (row.suggestions ?? []) : [],
    });
  },
);

// ---------------------------------------------------------------------------
// Daemon endpoints: the VM daemon's side of the turn engine. Authenticated
// by the per-sandbox daemon token (except /source, which is just code).
// ---------------------------------------------------------------------------

/** Token → the sandbox row it belongs to, or null. */
async function sandboxForToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 8) return null;
  return (
    (await db.query.sandbox.findFirst({
      where: eq(sandbox.daemonToken, token),
    })) ?? null
  );
}

/** The daemon's own source — served so ensure-daemon.sh can self-update
    the VM's copy when the version stamp changes. Public: it's the same
    code that ships in this repo, with no secrets inside. */
app.get('/api/daemon/source', (c) =>
  c.text(DAEMON_SOURCE, 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
  }),
);

/** Skills + browser CLI, fetched by the daemon once per version. */
app.get('/api/daemon/assets', async (c) => {
  const row = await sandboxForToken(c.req.query('token'));
  if (!row) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(daemonAssets());
});

const daemonContextSchema = z.object({
  token: z.string(),
  extensions: z.array(z.string()).max(50).default([]),
  reports: z.array(z.string()).max(50).default([]),
});

/** Bodies for the context files a turn's manifest listed and the VM is
    missing: extension scripts and report markdown. */
app.post('/api/daemon/context', async (c) => {
  const body = daemonContextSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!body.success) return c.json({ error: 'Malformed request' }, 400);
  const row = await sandboxForToken(body.data.token);
  if (!row) return c.json({ error: 'Unauthorized' }, 401);

  const [extensionRows, reportRows] = await Promise.all([
    body.data.extensions.length > 0
      ? db.query.extension.findMany({
          where: and(
            eq(extension.userId, row.userId),
            inArray(extension.id, body.data.extensions),
          ),
        })
      : Promise.resolve([]),
    body.data.reports.length > 0
      ? db.query.report.findMany({
          where: and(
            eq(report.userId, row.userId),
            inArray(report.id, body.data.reports),
          ),
        })
      : Promise.resolve([]),
  ]);
  return c.json({
    extensions: extensionRows.map((ext) => ({
      id: ext.id,
      version: ext.version,
      script: ext.script,
    })),
    reports: reportRows.map((rep) => ({
      id: rep.id,
      version: 1,
      body: reportFileBody(rep),
    })),
  });
});

const daemonSyncSchema = z.object({
  token: z.string(),
  /** Turn ids currently executing on the VM — heartbeat. */
  active: z.array(z.string()).max(50).default([]),
  /** Ack of turns picked up (informational; delivery already marked them
      running). */
  started: z.array(z.string()).max(50).default([]),
  /** Update batches: one row per (turn, seq). */
  updates: z
    .array(
      z.object({
        turnId: z.string(),
        seq: z.number().int().positive(),
        updates: z.array(z.record(z.string(), z.unknown())).max(600),
      }),
    )
    .max(100)
    .default([]),
  /** Browser-action requests from the CLI mailboxes. */
  actions: z
    .array(
      z.object({
        turnId: z.string(),
        action: z.unknown(),
      }),
    )
    .max(50)
    .default([]),
  /** Turn settlements to negotiate. */
  settles: z
    .array(
      z.object({
        turnId: z.string(),
        reply: z.string().max(400_000).optional(),
        stopReason: z.string().max(100).optional(),
        outcomeRaw: z.string().max(600_000).nullish(),
        retried: z.boolean().optional(),
        error: z.string().max(4000).optional(),
      }),
    )
    .max(20)
    .default([]),
  /** Action ids awaiting results. */
  pollActions: z.array(z.string()).max(100).default([]),
});

/**
 * The daemon's multiplexed heartbeat: everything it has to say rides one
 * request per ~1s, and everything the server has for it rides the
 * response. This is the entire live protocol between the VM and the API.
 */
app.post('/api/daemon/sync', async (c) => {
  const body = daemonSyncSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Malformed sync' }, 400);
  const row = await sandboxForToken(body.data.token);
  if (!row) return c.json({ error: 'Unauthorized' }, 401);
  const userId = row.userId;
  const now = Date.now();
  const {
    active,
    updates,
    actions,
    settles,
    pollActions,
  } = body.data;

  // Which of the referenced turns are really this user's — everything
  // below scopes writes to this set.
  const referenced = [
    ...new Set([
      ...active,
      ...updates.map((batch) => batch.turnId),
      ...actions.map((entry) => entry.turnId),
    ]),
  ];
  const owned = new Set(
    referenced.length > 0
      ? (
          await db.query.turn.findMany({
            where: and(eq(turn.userId, userId), inArray(turn.id, referenced)),
            columns: { id: true },
          })
        ).map((r) => r.id)
      : [],
  );

  // 1. Heartbeat for everything the daemon says it's executing.
  const beating = active.filter((id) => owned.has(id));
  if (beating.length > 0) {
    await db
      .update(turn)
      .set({ heartbeatAt: now })
      .where(and(inArray(turn.id, beating), eq(turn.status, 'running')));
  }

  // 2. Update batches (idempotent: a retried sync re-inserts harmlessly).
  const updateRows = updates
    .filter((batch) => owned.has(batch.turnId))
    .map((batch) => ({
      turnId: batch.turnId,
      seq: batch.seq,
      updates: batch.updates,
      createdAt: now,
    }));
  if (updateRows.length > 0) {
    await db.insert(turnUpdate).values(updateRows).onConflictDoNothing();
  }

  // 3. Browser-action requests. Malformed ones are answered immediately
  // so the CLI fails fast instead of timing out.
  const immediateResults: Array<{ id: string; result: unknown }> = [];
  const actionRows = [];
  for (const entry of actions) {
    if (!owned.has(entry.turnId)) continue;
    const parsed = browserActionSchema.safeParse(entry.action);
    if (!parsed.success) {
      const id = (entry.action as { id?: unknown })?.id;
      if (typeof id === 'string') {
        immediateResults.push({
          id,
          result: { ok: false, error: 'malformed browser action' },
        });
      }
      continue;
    }
    actionRows.push({
      id: parsed.data.id,
      turnId: entry.turnId,
      userId,
      request: parsed.data,
      status: 'pending' as const,
      createdAt: now,
    });
  }
  if (actionRows.length > 0) {
    await db.insert(browserAction).values(actionRows).onConflictDoNothing();
  }

  // 4. Settle negotiations.
  const settleResults: SettleVerdict[] = [];
  for (const settle of settles) {
    try {
      settleResults.push(await processSettle(userId, settle));
    } catch (error) {
      console.error('[daemon] settle failed:', error);
      // Tell the daemon it's done — the turn row stays running and the
      // stale sweep will fail it visibly rather than wedging the daemon.
      settleResults.push({ turnId: settle.turnId, ok: true });
    }
  }

  // 5. Results for actions the extension answered. Delivered once, then
  // deleted — screenshots ride these rows and shouldn't linger.
  let actionResults: Array<{ id: string; result: unknown }> = immediateResults;
  if (pollActions.length > 0) {
    const answered = await db.query.browserAction.findMany({
      where: and(
        eq(browserAction.userId, userId),
        inArray(browserAction.id, pollActions),
        eq(browserAction.status, 'done'),
      ),
    });
    if (answered.length > 0) {
      await db.delete(browserAction).where(
        inArray(
          browserAction.id,
          answered.map((a) => a.id),
        ),
      );
      actionResults = [
        ...immediateResults,
        ...answered.map((a) => ({ id: a.id, result: a.result })),
      ];
    }
  }

  // 6. Queued turns for this VM — marked running at delivery so a second
  // sync can't double-execute them.
  const queued = await db.query.turn.findMany({
    where: and(eq(turn.vmId, row.vmId), eq(turn.status, 'queued')),
    orderBy: [asc(turn.createdAt)],
    limit: 3,
  });
  const delivered = [];
  for (const pending of queued) {
    const [claimed] = await db
      .update(turn)
      .set({ status: 'running', startedAt: now, heartbeatAt: now })
      .where(and(eq(turn.id, pending.id), eq(turn.status, 'queued')))
      .returning();
    if (claimed) delivered.push(claimed);
  }

  // 7. Cancels for running turns.
  const cancels = await db.query.turn.findMany({
    where: and(
      eq(turn.vmId, row.vmId),
      eq(turn.status, 'running'),
      eq(turn.cancelRequested, true),
    ),
    columns: { id: true },
  });

  return c.json({
    daemonVersion: DAEMON_VERSION,
    turns: delivered.map((t) => ({
      id: t.id,
      taskId: t.taskId,
      provider: t.provider,
      message: t.message,
      preamble: t.preamble,
      outcomePath: t.outcomePath,
      contextManifest: t.contextManifest ?? [],
      agentCommand: t.agentCommand,
    })),
    cancels: cancels.map((t) => t.id),
    actionResults,
    settleResults,
  });
});

/** Machine-readable spec + human-readable reference, straight from the routes. */
app.get(
  '/openapi',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'Web Butler API',
        version: '0.0.1',
        description: 'Agent backend for the Web Butler extension',
      },
      servers: [{ url: 'http://localhost:8787', description: 'Local dev' }],
    },
  }),
);
app.get('/docs', Scalar({ url: '/openapi' }));

export default app;
