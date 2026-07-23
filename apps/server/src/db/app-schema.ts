import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

/**
 * One Freestyle VM per user — the butler's workspace, created lazily the
 * first time the extension initializes and reused for every run after.
 */
export const sandbox = pgTable('sandbox', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  vmId: text('vm_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
     * replay in the side panel's activity view across sessions.
     */
    updates: jsonb('updates').$type<
      Array<{
        at: number;
        kind: 'thought' | 'message' | 'tool' | 'user';
        text: string;
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
