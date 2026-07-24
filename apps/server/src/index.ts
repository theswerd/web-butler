import './env';
import { serve } from '@hono/node-server';
import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { describeRoute, openAPIRouteHandler, resolver } from 'hono-openapi';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth, trustedOrigins } from './auth';
import { getAcpBridge } from './acp';
import {
  BUTLER_BRIEFING,
  buildTurnMessage,
  extensionClaimRetryMessage,
  extensionProblem,
  extensionStageSchema,
  matchesPattern,
  newOutcomePath,
  outcomeRetryMessage,
  pageContextSchema,
  readOutcomes,
  syncTurnContext,
  type Outcome,
} from './butler';
import {
  awaitBrowserAction,
  drainActions,
  resolveBrowserAction,
} from './browser-tool';
import {
  getClaudeAuthStatus,
  startClaudeLogin,
  submitClaudeLoginCode,
} from './claude-auth';
import { getCodexAuthStatus, startCodexDeviceLogin } from './codex-auth';
import { getGrokAuthStatus, startGrokDeviceLogin } from './grok-auth';
import { db, hasDatabaseUrl } from './db';
import { extension, report, sandbox, task } from './db/schema';
import { getFreestyle } from './freestyle';
import { withSandboxVm } from './sandbox-heal';

if (!hasDatabaseUrl) {
  console.error(
    'DATABASE_URL is not set. Copy apps/server/.env.example to .env and ' +
      'paste your Neon connection string.',
  );
  process.exit(1);
}

const app = new Hono();

app.use('*', logger());

/**
 * Cookie-based sessions require credentialed CORS, which in turn requires
 * echoing the exact caller origin instead of `*`. Trusted: localhost, any
 * extension origin (ids differ per machine), and origins from the env.
 * `set-auth-token` must be exposed for the extension's bearer-token flow.
 */
const isTrustedOrigin = (origin: string) =>
  origin.startsWith('chrome-extension://') || trustedOrigins.includes(origin);

app.use(
  '/api/*',
  cors({
    origin: (origin) => (isTrustedOrigin(origin) ? origin : null),
    credentials: true,
    exposeHeaders: ['set-auth-token'],
  }),
);

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
    try {
      // Built by scripts/build-snapshot.ts — agent CLIs preinstalled.
      ({ vmId } = await getFreestyle().vms.create({
        snapshotId: process.env.FREESTYLE_SNAPSHOT_ID ?? null,
      }));
    } catch (error) {
      console.error('[init] freestyle vm create failed:', error);
      return c.json({ error: 'Sandbox provisioning failed' }, 502);
    }

    // Two concurrent inits can both create a VM; the primary key makes the
    // first insert win and the loser's VM is deleted rather than leaked.
    const inserted = await db
      .insert(sandbox)
      .values({ userId, vmId })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      void getFreestyle()
        .vms.delete({ vmId })
        .catch(() => {});
      const winner = await db.query.sandbox.findFirst({
        where: eq(sandbox.userId, userId),
      });
      return c.json({
        user: { id: userId, isAnonymous: session.user.isAnonymous ?? false },
        sandbox: { vmId: winner!.vmId, created: false },
      });
    }

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
      hard so a hostile client can't stuff megabytes into one row. */
  updates: z
    .array(
      z.object({
        at: z.number(),
        kind: z.enum(['thought', 'message', 'tool', 'user']),
        text: z.string().max(20_000),
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
// (`extension` outcomes, stored by the prompt route below). The browser
// extension mirrors these into chrome.userScripts registrations; these
// routes serve that sync plus the user-facing toggle/delete controls.
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

/**
 * Apply the agent's extension outcomes to the DB. Each outcome is either
 * enriched with the stored row's identity (so the client can upsert its
 * cache and register the user script without refetching) or replaced by a
 * response outcome explaining why it was rejected — the turn still lands.
 */
async function storeExtensionOutcomes(
  userId: string,
  taskId: string | undefined,
  outcomes: Outcome[],
): Promise<Outcome[]> {
  const processed: Outcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.type !== 'extension') {
      processed.push(outcome);
      continue;
    }
    const problem = extensionProblem(outcome);
    if (problem) {
      console.warn(`[butler] extension outcome rejected: ${problem}`);
      processed.push({
        type: 'response',
        markdown: `I tried to ${outcome.action} a page extension ("${outcome.name}") but it was rejected: ${problem}.`,
      });
      continue;
    }
    const now = Date.now();
    if (outcome.action === 'create') {
      const id = crypto.randomUUID();
      await db.insert(extension).values({
        id,
        userId,
        name: outcome.name,
        description: outcome.description,
        urlPatterns: outcome.urlPatterns,
        script: outcome.script,
        stage: outcome.stage,
        taskId,
        createdAt: now,
        updatedAt: now,
      });
      processed.push({ ...outcome, id });
    } else if (outcome.action === 'update') {
      const [row] = await db
        .update(extension)
        .set({
          name: outcome.name,
          description: outcome.description,
          urlPatterns: outcome.urlPatterns,
          script: outcome.script,
          stage: outcome.stage,
          taskId,
          updatedAt: now,
          version: sql`${extension.version} + 1`,
        })
        .where(
          and(eq(extension.id, outcome.id!), eq(extension.userId, userId)),
        )
        .returning();
      if (!row) {
        processed.push({
          type: 'response',
          markdown: `I tried to update a page extension but its id ("${outcome.id}") doesn't exist anymore.`,
        });
        continue;
      }
      processed.push(outcome);
    } else {
      await db
        .delete(extension)
        .where(
          and(eq(extension.id, outcome.id!), eq(extension.userId, userId)),
        );
      processed.push(outcome);
    }
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Claim-vs-outcome consistency. An agent that SAYS "I installed an
// extension" without declaring one in its outcome file leaves the user
// with a confident claim and nothing behind it. The detector is a
// heuristic on purpose: a false positive costs one corrective turn or a
// visible warning, a false negative costs the user an extension that
// silently never existed.
// ---------------------------------------------------------------------------

/** A completed-sounding verb near "extension", either order, within one
    sentence. Past-tense forms only, so instructions like "you can create
    an extension by..." don't read as claims. */
const EXTENSION_CLAIM =
  /\b(?:installed|created|updated|added|saved|registered|set\s+up)\b[^.!?\n]{0,60}\bextensions?\b|\bextensions?\b[^.!?\n]{0,60}\b(?:installed|created|updated|added|saved|registered|set\s+up)\b/gi;

/** Words that turn a matched mention into an honest admission ("I could
    not install the extension"). Pushing back on those would punish the
    agent for telling the truth. */
const CLAIM_NEGATION =
  /\b(?:not|no|never|none|unable|cannot|can't|couldn't|didn't|wasn't|hasn't|haven't|won't|fail\w*|instead|without)\b/i;

/**
 * True when the turn produced no extension outcome but its text still
 * asserts one was installed, created, or updated. `reply` carries the
 * streamed assistant text for the first pass; the post-retry pass omits
 * it, because a retry can rewrite the outcome but never the stream.
 */
function claimsExtensionWithoutOutcome(
  outcomes: Outcome[],
  reply = '',
): boolean {
  if (outcomes.some((outcome) => outcome.type === 'extension')) return false;
  const texts = [
    reply,
    ...outcomes.flatMap((outcome) =>
      outcome.type === 'response' || outcome.type === 'artifact'
        ? [outcome.markdown]
        : [],
    ),
  ];
  return texts.some((text) =>
    [...text.matchAll(EXTENSION_CLAIM)].some((match) => {
      // The negation often sits just before the matched window ("No
      // extension was installed"), so scan a short same-sentence
      // look-behind together with the match itself.
      const lead =
        text
          .slice(Math.max(0, match.index - 40), match.index)
          .split(/[.!?\n]/)
          .pop() ?? '';
      return !CLAIM_NEGATION.test(lead + match[0]);
    }),
  );
}

const EXTENSION_CLAIM_WARNING =
  '**Warning:** this reply mentions an installed extension, but no ' +
  'extension was actually saved. Nothing persistent was created. Try ' +
  'asking again.';

/** Pin the warning onto the response outcome (or add one) so the unbacked
    claim never reaches the user looking like a success. */
function withExtensionClaimWarning(outcomes: Outcome[]): Outcome[] {
  let appended = false;
  const flagged = outcomes.map((outcome): Outcome => {
    if (outcome.type !== 'response' || appended) return outcome;
    appended = true;
    return {
      ...outcome,
      markdown: `${outcome.markdown}\n\n${EXTENSION_CLAIM_WARNING}`,
    };
  });
  if (!appended) {
    flagged.push({ type: 'response', markdown: EXTENSION_CLAIM_WARNING });
  }
  return flagged;
}

/** How long the server waits for the extension to perform one action
    before telling the CLI it timed out. Well under the CLI's own 60s. */
const ACTION_TIMEOUT_MS = 45_000;

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

// ---------------------------------------------------------------------------
// Detached turn jobs. A turn used to live and die with the HTTP request
// that started it — when the extension's MV3 service worker got recycled
// mid-task, the dropped request cancelled the actual agent turn on the VM.
// Now the POST route starts a server-side JOB that runs to completion no
// matter who is listening: connections are just windows onto it. A revived
// worker re-attaches with GET /api/agent/attach and picks up where the
// dead one left off; only an explicit POST /api/agent/cancel stops the
// agent.
// ---------------------------------------------------------------------------

type TurnJob = {
  id: string;
  /** The extension-side task this turn belongs to (cancel targets it). */
  taskId?: string;
  userId: string;
  /** Buffered update lines plus the single terminal line. The seq of
      lines[i] is baseSeq + i + 1 — absolute and stable across trimming, so
      a re-attaching client can resume from its last-seen cursor. */
  lines: Record<string, unknown>[];
  baseSeq: number;
  done: boolean;
  finishedAt?: number;
  /** Currently attached streams (0..n — the job doesn't care). */
  listeners: Set<(payload: Record<string, unknown>) => void>;
  /** Browser actions still waiting on a result, re-delivered on attach so
      a worker bounce doesn't strand the agent's `browser` call. */
  pendingActions: Map<string, { id: string }>;
  /** Explicit user cancel. Client disconnects never touch it. */
  abort: AbortController;
};

const turnJobs = new Map<string, TurnJob>();

/** Finished jobs linger so a late re-attach can still collect the terminal
    line, then get swept. */
const TURN_JOB_KEEP_MS = 30 * 60_000;

/** Line-buffer cap per job. Old updates fall off the front (baseSeq moves);
    a re-attaching client mostly needs recent activity plus the terminal. */
const TURN_JOB_MAX_LINES = 2000;

function newTurnJob(userId: string, taskId?: string): TurnJob {
  // Opportunistic GC — jobs are only ever born here.
  for (const [id, job] of turnJobs) {
    if (
      job.done &&
      job.finishedAt !== undefined &&
      Date.now() - job.finishedAt > TURN_JOB_KEEP_MS
    ) {
      turnJobs.delete(id);
    }
  }
  const job: TurnJob = {
    id: crypto.randomUUID(),
    taskId,
    userId,
    lines: [],
    baseSeq: 0,
    done: false,
    listeners: new Set(),
    pendingActions: new Map(),
    abort: new AbortController(),
  };
  turnJobs.set(job.id, job);
  return job;
}

/** Buffer a line for replay and fan it out to whoever is attached. */
function emitTurnLine(job: TurnJob, payload: Record<string, unknown>): void {
  job.lines.push(payload);
  if (job.lines.length > TURN_JOB_MAX_LINES) {
    const drop = job.lines.length - TURN_JOB_MAX_LINES;
    job.lines.splice(0, drop);
    job.baseSeq += drop;
  }
  const seq = job.baseSeq + job.lines.length;
  for (const listener of job.listeners) listener({ seq, ...payload });
}

/** Actions are NOT replayable history (a replayed click would double-fire);
    they live in pendingActions until resolved and are re-sent on attach. */
function deliverTurnAction(job: TurnJob, action: { id: string }): void {
  job.pendingActions.set(action.id, action);
  for (const listener of job.listeners) listener({ action });
}

/**
 * One NDJSON window onto a job: replay everything after the caller's
 * cursor, re-send pending actions, then stream live until the terminal
 * line. A dropped connection detaches quietly — the job runs on.
 */
function streamTurnJob(
  job: TurnJob,
  since: number,
  announce: boolean,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (payload: Record<string, unknown>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
        } catch {
          open = false; // client gone — detach below, the job runs on
        }
      };
      // Per-connection keepalive (the job itself never heartbeats): pings
      // make silence abnormal so the extension can time out a dead pipe.
      const heartbeat = setInterval(() => write({ ping: true }), 20_000);
      const detach = () => {
        open = false;
        clearInterval(heartbeat);
        job.listeners.delete(listener);
      };
      const finish = () => {
        detach();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const listener = (payload: Record<string, unknown>) => {
        write(payload);
        if ('done' in payload || 'error' in payload) finish();
      };
      if (announce) write({ job: job.id });
      let sawTerminal = false;
      job.lines.forEach((line, index) => {
        const seq = job.baseSeq + index + 1;
        if (seq <= since) return;
        write({ seq, ...line });
        if ('done' in line || 'error' in line) sawTerminal = true;
      });
      if (job.done || sawTerminal) {
        finish();
        return;
      }
      for (const action of job.pendingActions.values()) write({ action });
      job.listeners.add(listener);
      signal.addEventListener('abort', detach, { once: true });
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Fallback DB settle at a job's terminal: if no client ever comes back for
 * the result (browser closed for good), the task row must not claim
 * "running" forever. The extension's own settle re-syncs richer fields
 * (report/extension links, curated outcome text) over this when it does
 * return; a row the user already stopped is left alone.
 */
async function settleTaskRowFromJob(job: TurnJob): Promise<void> {
  if (!job.taskId) return;
  const terminal = (job.lines[job.lines.length - 1] ?? {}) as {
    error?: unknown;
    text?: unknown;
  };
  const error = typeof terminal.error === 'string' ? terminal.error : undefined;
  const text = typeof terminal.text === 'string' ? terminal.text.trim() : '';
  const summary = error ?? (text ? text.slice(0, 200) : 'Finished');
  try {
    await db
      .update(task)
      .set({
        status: error !== undefined ? 'failed' : 'done',
        outcome: summary,
        finishedAt: Date.now(),
      })
      .where(
        and(
          eq(task.id, job.taskId),
          eq(task.userId, job.userId),
          eq(task.status, 'running'),
        ),
      );
  } catch (dbError) {
    console.warn('[butler] terminal task settle failed:', dbError);
  }
}

/**
 * Run one agent turn on the user's sandbox VM over ACP. The prompt is
 * wrapped in the Web Butler envelope (butler.ts): briefing on fresh
 * sessions, page context on every message, and an outcome-file path the
 * agent writes its structured result to. The response is NDJSON: a first
 * `{"job"}` line naming the detached job, one line per `session/update`
 * from the agent as it works (`{"seq", "update": …}`), then exactly one
 * terminal line — `{"done": true, "stopReason", "text", "outcomes"}` with
 * the agent's declared outcomes (short markdown response or long-form
 * artifact), or `{"error"}`. Disconnecting does NOT cancel the turn: the
 * job keeps running and the client re-attaches via /api/agent/attach.
 */
app.post(
  '/api/agent/prompt',
  describeRoute({
    description:
      "Send a prompt to an agent CLI on the user's sandbox VM via ACP; " +
      'streams progress as NDJSON and ends with a done or error line',
    responses: {
      200: {
        description: 'NDJSON stream of session updates, then a terminal line',
        content: { 'application/x-ndjson': {} },
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
    const body = agentPromptSchema.safeParse(await c.req.json().catch(() => null));
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

    // Mirror the stored work onto the VM so the agent can READ it: each
    // extension's current script (the ground truth for updates/merges) and
    // each report's markdown (for "like that report from earlier"). The
    // envelope below lists the file paths. This is also the turn's first VM
    // touch, so it doubles as the heal point: a deleted VM gets replaced
    // here and the rest of the turn runs against the fresh one.
    const vmId = await withSandboxVm(userId, result.vmId, async (id) => {
      await syncTurnContext(id, allExtensions, reportRows);
      return id;
    });

    const clip = (text: string, max: number) =>
      text.length > max ? `${text.slice(0, max - 3)}…` : text;

    // One bridge per task: its own agent process and session, so tasks run
    // concurrently and a follow-up prompt with the same taskId lands in the
    // conversation that already has the context.
    const bridge = getAcpBridge(vmId, provider, taskId);
    bridge.setPreamble(BUTLER_BRIEFING);
    const outcomePath = newOutcomePath();
    const text = buildTurnMessage(prompt, page, outcomePath, {
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

    const job = newTurnJob(userId, taskId);

    // Browser control: while the turn runs, poll the VM mailbox for
    // `browser` CLI requests, relay each to whoever is attached as an
    // {action} line, and let drainActions write the response file that
    // unblocks the CLI once the extension POSTs its result back. The
    // extension answers over /api/agent/action-result (resolveBrowser-
    // Action), not the one-directional job stream. The poll belongs to the
    // JOB, not the connection — actions keep flowing across re-attaches.
    const handledActions = new Set<string>();
    let draining = false;
    const actionPoll = setInterval(() => {
      if (draining) return; // don't stack polls if a drain runs long
      draining = true;
      void drainActions(vmId, bridge.actionsDir, handledActions, (action) => {
        deliverTurnAction(job, action);
        const settled = awaitBrowserAction(action.id, ACTION_TIMEOUT_MS);
        void settled
          .catch(() => undefined)
          .then(() => job.pendingActions.delete(action.id));
        return settled;
      })
        .catch(() => {})
        .finally(() => {
          draining = false;
        });
    }, 500);

    // The reply is assembled server-side from message chunks so the
    // terminal line always carries the full text, even if the client
    // dropped some updates.
    let reply = '';
    bridge
      .prompt(
        text,
        (update) => {
          if (
            update.sessionUpdate === 'agent_message_chunk' &&
            typeof (update.content as { text?: string })?.text === 'string'
          ) {
            reply += (update.content as { text: string }).text;
          }
          emitTurnLine(job, { update });
        },
        job.abort.signal,
      )
      .then(async ({ stopReason }) => {
        // The agent's structured declaration of what it produced; a
        // missing file degrades to the streamed reply text. A file we
        // REJECTED gets one corrective turn — the agent already did
        // the work, it just misdeclared it — and if that fails too,
        // the fallback says so instead of presenting the streamed
        // reply as if the declared work landed.
        let read = await readOutcomes(vmId, outcomePath, reply);
        // At most ONE corrective turn total, shared between the two
        // failure modes (rejected file, unbacked extension claim):
        // stacking them would double the tail latency of a turn that
        // already went long, for an agent that already fumbled once.
        let retried = false;
        if (read.invalid && !job.abort.signal.aborted) {
          retried = true;
          const retryPath = newOutcomePath();
          try {
            await bridge.prompt(
              outcomeRetryMessage(read.invalid, retryPath),
              (update) => emitTurnLine(job, { update }),
              job.abort.signal,
            );
            const retry = await readOutcomes(vmId, retryPath, reply);
            // A retry that wrote no file resolves nothing: keep the
            // original rejection so the warning below still lands,
            // instead of quietly presenting the streamed reply.
            if (!retry.invalid && !retry.fileMissing) read = retry;
          } catch (error) {
            console.warn(`[butler] outcome retry failed:`, error);
          }
        }
        if (read.invalid) {
          read.outcomes = [
            {
              type: 'response',
              markdown:
                `${reply.trim() || 'Done.'}\n\n` +
                `**Warning:** the structured result for this turn was malformed (${read.invalid}), ` +
                'so anything it claims to have installed or produced was NOT saved. Try asking again.',
            },
          ];
        } else if (
          !retried &&
          !job.abort.signal.aborted &&
          claimsExtensionWithoutOutcome(read.outcomes, reply)
        ) {
          // The turn SAYS an extension landed but declared none. Same
          // one-shot correction as a rejected file: the agent either
          // backs the claim with the real outcome or retracts it.
          const retryPath = newOutcomePath();
          try {
            await bridge.prompt(
              extensionClaimRetryMessage(retryPath, read.fileMissing === true),
              (update) => emitTurnLine(job, { update }),
              job.abort.signal,
            );
            const retry = await readOutcomes(vmId, retryPath, reply);
            // Only an actually-written, valid file can settle the
            // claim; anything less keeps the original outcomes and
            // earns the warning below.
            if (!retry.invalid && !retry.fileMissing) read = retry;
          } catch (error) {
            console.warn(`[butler] extension claim retry failed:`, error);
          }
          // Re-check the outcomes alone: a successful retry either
          // added the extension outcome or rewrote the response to
          // retract the claim. If neither happened, the user must see
          // that nothing was saved.
          if (claimsExtensionWithoutOutcome(read.outcomes)) {
            read.outcomes = withExtensionClaimWarning(read.outcomes);
          }
        }
        // Extension outcomes are persisted here, so the terminal line
        // carries stored ids the client can register directly.
        const outcomes = await storeExtensionOutcomes(
          userId,
          taskId,
          read.outcomes,
        );
        emitTurnLine(job, {
          done: true,
          stopReason,
          text: reply,
          outcomes,
          suggestions: read.suggestions,
          highlights: read.highlights,
        });
      })
      .catch((error: unknown) => {
        console.error(`[acp:${provider}] turn failed:`, error);
        emitTurnLine(job, {
          error: error instanceof Error ? error.message : 'agent turn failed',
        });
      })
      .finally(() => {
        clearInterval(actionPoll);
        job.done = true;
        job.finishedAt = Date.now();
        void settleTaskRowFromJob(job);
      });

    return streamTurnJob(job, 0, true, c.req.raw.signal);
  },
);

/**
 * Re-attach to a detached turn job after a dropped stream or a recycled
 * service worker. Replays every buffered line after `since` (the caller's
 * last-seen seq), re-delivers pending browser actions, then streams live.
 * 404 means the job is genuinely gone (server restart, or it finished
 * over 30 minutes ago) — the caller should settle the task as interrupted.
 */
app.get(
  '/api/agent/attach',
  describeRoute({
    description:
      'Re-attach to a running (or recently finished) agent turn job; ' +
      'streams NDJSON from the given seq cursor to the terminal line',
    responses: {
      200: {
        description: 'NDJSON stream of buffered + live lines',
        content: { 'application/x-ndjson': {} },
      },
      404: {
        description: 'No such job (finished long ago, or server restarted)',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const jobId = c.req.query('job');
    const since = Number(c.req.query('since') ?? '0') || 0;
    const job = jobId ? turnJobs.get(jobId) : undefined;
    if (!job || job.userId !== session.user.id) {
      return c.json({ error: 'no such turn' }, 404);
    }
    return streamTurnJob(job, since, false, c.req.raw.signal);
  },
);

/**
 * Explicitly cancel a task's turns. This is the ONLY thing that aborts the
 * agent on the VM now that disconnects don't — the extension's stop button
 * calls it alongside dropping its own streams.
 */
app.post(
  '/api/agent/cancel',
  describeRoute({
    description: 'Cancel every running turn job belonging to a task',
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
    for (const job of turnJobs.values()) {
      if (
        job.userId === session.user.id &&
        job.taskId === body.data.taskId &&
        !job.done
      ) {
        job.abort.abort();
      }
    }
    return c.json({ ok: true });
  },
);

// --- Page starters -----------------------------------------------------------
// Small, page-specific prompt suggestions for the empty prompt box,
// generated by the user's own AI. One dedicated ACP session per (vm,
// provider) — the reserved task id below — kept warm between pages so
// only the first page pays agent spawn. Results are cached per (user,
// page) so browsing back and forth doesn't re-bill the user's plan.

/** Reserved bridge task id. Client task ids are UUIDs, so this can't
    collide with a real conversation. */
const STARTERS_TASK_ID = 'wb-starters';

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

const startersCache = new Map<string, { at: number; starters: string[] }>();
const STARTERS_TTL_MS = 60 * 60 * 1000;
const STARTERS_CACHE_MAX = 2000;
/** Turn budget — suggestions are decoration; nobody waits minutes for them. */
const STARTERS_TIMEOUT_MS = 75_000;

function startersCacheKey(userId: string, url: string): string {
  try {
    const u = new URL(url);
    // The hash is client-side view state, not a different page.
    return `${userId}:${u.origin}${u.pathname}${u.search}`;
  } catch {
    return `${userId}:${url}`;
  }
}

/** The model was told "JSON array only", but models decorate — take the
    outermost bracketed slice and validate the shape strictly. */
function parseStarters(reply: string): string[] {
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= 90)
      .slice(0, 3);
  } catch {
    return [];
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
      'Generate up to 3 page-specific starter prompts with the active ' +
      'provider. Cached per page; returns {starters: []} when the page is ' +
      'too thin, the provider is not connected, or generation fails.',
    responses: {
      200: {
        description: 'Starter prompts for this page (possibly empty)',
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

    const key = startersCacheKey(result.userId, url);
    const hit = startersCache.get(key);
    if (hit && Date.now() - hit.at < STARTERS_TTL_MS) {
      return c.json({ starters: hit.starters });
    }

    try {
      const vmId = await withSandboxVm(result.userId, result.vmId, (id) =>
        Promise.resolve(id),
      );
      const bridge = getAcpBridge(vmId, provider, STARTERS_TASK_ID);
      bridge.setPreamble(STARTERS_PREAMBLE);

      // Bounded: client gone or budget spent → cancel the turn.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STARTERS_TIMEOUT_MS);
      const onClientGone = () => controller.abort();
      c.req.raw.signal.addEventListener('abort', onClientGone, { once: true });

      let reply = '';
      try {
        await bridge.prompt(
          `Page: ${url}\nTitle: ${title}\n\nExtract:\n${signal}`,
          (update) => {
            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              typeof (update.content as { text?: string })?.text === 'string'
            ) {
              reply += (update.content as { text: string }).text;
            }
          },
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
        c.req.raw.signal.removeEventListener('abort', onClientGone);
      }

      const starters = parseStarters(reply);
      // Cache empties too: a page the model can't say anything specific
      // about shouldn't be retried on every tab switch.
      startersCache.set(key, { at: Date.now(), starters });
      if (startersCache.size > STARTERS_CACHE_MAX) {
        // Drop the oldest half — Map iterates in insertion order.
        const stale = [...startersCache.keys()].slice(
          0,
          Math.floor(STARTERS_CACHE_MAX / 2),
        );
        for (const k of stale) startersCache.delete(k);
      }
      return c.json({ starters });
    } catch (error) {
      // Provider not signed in, VM mid-provision, agent hiccup — all mean
      // the same thing to the prompt box: no chips this time. Decoration
      // must never surface an error state.
      console.warn(`[starters:${provider}] generation failed:`, error);
      return c.json({ starters: [] });
    }
  },
);

/**
 * The extension's answer to one browser action relayed on the prompt
 * stream. Resolves the promise drainActions is parked on, which then
 * writes the VM response file that unblocks the `browser` CLI. This is the
 * return leg the (one-directional) NDJSON stream can't carry.
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
    const delivered = resolveBrowserAction(body.data.id, body.data.result);
    return c.json({ delivered });
  },
);

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

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`web-butler server listening on http://localhost:${info.port}`);
});
