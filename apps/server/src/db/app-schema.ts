import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

/**
 * One Freestyle VM per user — the butler's workspace, created lazily the
 * first time the extension initializes and reused for every run after.
 */
export const sandbox = pgTable(
  'sandbox',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    vmId: text('vm_id').notNull(),
    /**
     * Bearer credential for the VM's daemon: the daemon reads it from a
     * file the server wrote at provision time and presents it on every
     * /api/daemon/* call. Rotates whenever the VM is (re)provisioned.
     */
    daemonToken: text('daemon_token'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('sandbox_daemon_token_idx').on(table.daemonToken)],
);

/**
 * The user's activity history: one row per run, mirroring the extension's
 * Task shape. The extension's background is the only writer (it upserts on
 * create and again on settle); the session cache in the extension hydrates
 * from here on startup, which is what makes history outlive the browser.
 * Epoch millis (not timestamps) — the UI computes with Date.now().
 */
export const task = pgTable(
  'task',
  {
    /** Run id, minted by the extension. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['tab', 'global'] }).notNull(),
    prompt: text('prompt').notNull(),
    url: text('url').notNull(),
    status: text('status', {
      enum: ['running', 'done', 'failed', 'stopped'],
    }).notNull(),
    startedAt: bigint('started_at', { mode: 'number' }).notNull(),
    finishedAt: bigint('finished_at', { mode: 'number' }),
    outcome: text('outcome'),
    reportId: text('report_id'),
    /** Set when the run installed/updated a site extension — the row links. */
    extensionId: text('extension_id'),
    seen: boolean('seen').notNull().default(true),
    /**
     * The agent's streamed activity feed (tool calls, thinking, the reply
     * as it formed), written once when the task settles. Lets old tasks
     * replay in the side panel's activity view across sessions. Beyond
     * the prose kinds: 'browser' rows mirror ghost-cursor acts, and the
     * answer/report/extension/highlights entries are the settle-time
     * results rendered as cards and chips.
     */
    updates: jsonb('updates').$type<
      Array<{
        at: number;
        kind:
          | 'thought'
          | 'message'
          | 'tool'
          | 'user'
          | 'browser'
          | 'answer'
          | 'report'
          | 'extension'
          | 'highlights';
        text: string;
        /** kind 'browser': the verb, for iconography. */
        verb?: string;
        /** kind 'report' | 'extension': the secondary description line. */
        detail?: string;
        /** kind 'highlights': marker chips (id + pill label). */
        marks?: Array<{ id: string; label: string }>;
      }>
    >(),
    /**
     * Follow-up prompts the agent offered when the task settled — the
     * "suggested next" chips in the task activity view. Plain strings,
     * a few at most.
     */
    suggestions: jsonb('suggestions').$type<string[]>(),
  },
  (table) => [index('task_user_started_idx').on(table.userId, table.startedAt)],
);

/**
 * A long-form artifact the agent produced (an `artifact` outcome): the
 * report the side panel renders. Same write pattern as `task`: the
 * extension's background is the only writer (it syncs on publish), and
 * its session cache hydrates from here on startup so the Artifacts view
 * and old tasks' "Open report" links survive browser restarts.
 */
export const report = pgTable(
  'report',
  {
    /** uuid, minted by the extension when the artifact is published. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** "example.com · 4:12 PM" — where and when it was produced. */
    meta: text('meta'),
    /** Full markdown body. */
    text: text('text').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('report_user_created_idx').on(table.userId, table.createdAt)],
);

/**
 * One agent turn, queued by the extension and executed by the daemon on
 * the user's VM. This table IS the turn engine: the Worker only moves
 * rows through it (queued → running → settled) while the daemon and the
 * extension poll their respective sides. Nothing about a turn lives in
 * server memory, which is what lets the API run on stateless Workers.
 */
export const turn = pgTable(
  'turn',
  {
    /** uuid, server-minted. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The extension-side run this turn belongs to (cancel targets it). */
    taskId: text('task_id'),
    /** Which VM's daemon should pick this up. */
    vmId: text('vm_id').notNull(),
    provider: text('provider', {
      enum: ['codex', 'grok', 'claude'],
    }).notNull(),
    /** 'task' turns carry a full envelope; 'starters' turns are the tiny
        suggestion generations that ride the same queue. */
    kind: text('kind', { enum: ['task', 'starters'] })
      .notNull()
      .default('task'),
    status: text('status', {
      enum: ['queued', 'running', 'done', 'failed', 'cancelled'],
    }).notNull(),
    /** The full envelope text the daemon prompts the agent with. */
    message: text('message').notNull(),
    /** Standing instructions for the session's first turn (the briefing). */
    preamble: text('preamble'),
    /** Where the agent writes its outcomes JSON on the VM this turn. */
    outcomePath: text('outcome_path').notNull(),
    /** Extension/report files the daemon must mirror before prompting:
        [{kind:'extension'|'report', id, version}]. */
    contextManifest: jsonb('context_manifest').$type<
      Array<{ kind: 'extension' | 'report'; id: string; version: number }>
    >(),
    /** Dev/test override for the agent command (fake ACP agent). */
    agentCommand: text('agent_command'),
    /** Set by /api/agent/cancel; the daemon checks it every sync. */
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    /** Starters cache key (kind='starters' only): userId:origin+path. */
    cacheKey: text('cache_key'),
    /** How many settle negotiations ran (caps corrective retries at 1). */
    retries: integer('retries').notNull().default(0),
    /** Which corrective retry is in flight ('invalid' | 'claim'), plus the
        first round's parsed outcomes so a failed retry can fall back to
        them instead of losing the turn. */
    retryKind: text('retry_kind', { enum: ['invalid', 'claim'] }),
    pendingOutcomes: jsonb('pending_outcomes'),
    // Terminal payload — what GET /api/agent/turn returns when settled.
    reply: text('reply'),
    stopReason: text('stop_reason'),
    outcomes: jsonb('outcomes'),
    suggestions: jsonb('suggestions').$type<string[]>(),
    highlights: jsonb('highlights'),
    error: text('error'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    startedAt: bigint('started_at', { mode: 'number' }),
    finishedAt: bigint('finished_at', { mode: 'number' }),
    /** Daemon liveness, bumped on every sync that touches this turn —
        lazy sweeps mark a running turn failed when this goes stale. */
    heartbeatAt: bigint('heartbeat_at', { mode: 'number' }),
    /** Last time a wake exec was sent for this queued turn (throttle). */
    wakeAt: bigint('wake_at', { mode: 'number' }),
  },
  (table) => [
    index('turn_vm_status_idx').on(table.vmId, table.status),
    index('turn_user_created_idx').on(table.userId, table.createdAt),
    index('turn_cache_key_idx').on(table.cacheKey),
  ],
);

/**
 * One batch of `session/update` payloads from a running turn. The daemon
 * posts a batch per sync (~1s), the extension polls rows after its cursor.
 * Batched rather than per-update: agent message chunks arrive many times a
 * second and would otherwise mint hundreds of tiny rows per turn.
 */
export const turnUpdate = pgTable(
  'turn_update',
  {
    turnId: text('turn_id').notNull(),
    /** 1-based, dense per turn — the extension's replay cursor. */
    seq: integer('seq').notNull(),
    /** The batch: raw ACP session/update payloads, in arrival order. */
    updates: jsonb('updates').$type<Record<string, unknown>[]>().notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.turnId, table.seq] })],
);

/**
 * The browser-action mailbox, previously a file dance on the VM drained
 * over exec. The daemon inserts a row when the agent's `browser` CLI asks
 * for something; the extension sees it on its next turn poll, performs it,
 * and posts the result; the daemon collects the result on its next sync
 * and unblocks the CLI.
 */
export const browserAction = pgTable(
  'browser_action',
  {
    /** uuid, minted by the `browser` CLI on the VM. */
    id: text('id').primaryKey(),
    turnId: text('turn_id').notNull(),
    userId: text('user_id').notNull(),
    request: jsonb('request').notNull(),
    result: jsonb('result'),
    status: text('status', { enum: ['pending', 'done'] })
      .notNull()
      .default('pending'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    resolvedAt: bigint('resolved_at', { mode: 'number' }),
  },
  (table) => [index('browser_action_turn_idx').on(table.turnId, table.status)],
);

/**
 * A persistent page modification authored by the agent (an `extension`
 * outcome): a strictly-shaped JS script the browser extension registers as
 * a user script for every page matching `urlPatterns`. It stays applied
 * across visits until toggled off or deleted. One extension can span
 * multiple sites.
 */
export const extension = pgTable(
  'extension',
  {
    /** uuid, minted by the server when the outcome is stored. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    /** Chrome match patterns, e.g. "*://*.youtube.com/*". */
    urlPatterns: jsonb('url_patterns').$type<string[]>().notNull(),
    /** The full JS source — one webButler.register({apply, remove}) call. */
    script: text('script').notNull(),
    stage: text('stage', {
      enum: ['document_start', 'document_end', 'document_idle'],
    }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Bumped on every agent update — cache-busts registered copies. */
    version: integer('version').notNull().default(1),
    /** Provenance: the run (task id) that authored this version. */
    taskId: text('task_id'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('extension_user_idx').on(table.userId)],
);
