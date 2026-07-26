#!/usr/bin/env node
// Web Butler VM daemon. Runs ON the user's Freestyle sandbox VM and owns
// everything that used to require a live connection from the server:
//
//   - agent processes: spawns the provider's ACP CLI locally over stdio
//     (one process per task, kept alive between prompts for context)
//   - turns: polls the server for queued turns, streams updates back,
//     reads the outcome file, and negotiates settlement (the server may
//     ask for one corrective turn)
//   - the browser-action mailbox: watches the per-task actions directory
//     the `browser` CLI writes into, relays requests to the server, and
//     writes the response files that unblock the CLI
//
// The server side is stateless (Cloudflare Workers + Postgres); this
// process is the only long-lived piece, and it lives next to the agents.
// It exits after a few idle minutes so the VM can go back to sleep — the
// server wakes it with an exec when new work arrives.
//
// Source of truth: apps/server/vm-daemon/daemon.mjs. Embedded into the
// server by scripts/gen-daemon-source.mjs; served at /api/daemon/source.

import { spawn, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';

// Canonical VM paths, overridable so the daemon can run anywhere for
// local end-to-end testing (scripts/e2e-probe.mjs). The server always
// speaks in canonical /root/workspace paths; localPath() translates.
const VM_WORKSPACE = '/root/workspace';
const DIR = process.env.WB_DAEMON_DIR || '/opt/webbutler';
const WORKSPACE = process.env.WB_WORKSPACE || VM_WORKSPACE;
const ACTIONS_ROOT = WORKSPACE + '/.butler/actions';
const CONTEXT_DIR = WORKSPACE + '/.butler/context';
const MANIFEST_PATH = CONTEXT_DIR + '/manifest.json';

const localPath = (path) =>
  typeof path === 'string' && path.startsWith(VM_WORKSPACE)
    ? WORKSPACE + path.slice(VM_WORKSPACE.length)
    : path;

const SYNC_ACTIVE_MS = 900;
const SYNC_IDLE_MS = 2500;
const ACTION_SCAN_MS = 300;
const RPC_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 10 * 60_000;
const SESSION_IDLE_MS = 5 * 60_000;
const EXIT_AFTER_IDLE_MS = 2 * 60_000;

const log = (...parts) =>
  console.log(new Date().toISOString(), '[daemon]', ...parts);

// --- Config ----------------------------------------------------------------

const config = JSON.parse(readFileSync(DIR + '/daemon.json', 'utf8'));
const SERVER = config.serverUrl.replace(/\/$/, '');
const TOKEN = config.token;

// Single instance: if another live daemon holds the pidfile, defer to it.
const PID_PATH = DIR + '/daemon.pid';
try {
  const other = Number(readFileSync(PID_PATH, 'utf8'));
  if (other && other !== process.pid) {
    process.kill(other, 0); // throws when dead
    log('another daemon is running (pid ' + other + '); exiting');
    process.exit(0);
  }
} catch {
  /* stale or missing pidfile — we take over */
}
writeFileSync(PID_PATH, String(process.pid));

// --- Agent commands ----------------------------------------------------------

const AGENT_COMMANDS = {
  grok: 'exec grok --no-auto-update agent stdio',
  codex: 'export NO_BROWSER=1; exec codex-acp',
  claude: 'exec claude-agent-acp',
};

/** Codex/Claude speak ACP through adapters; older snapshots miss them. */
const ADAPTERS = {
  codex: { bin: 'codex-acp', pkg: '@agentclientprotocol/codex-acp' },
  claude: { bin: 'claude-agent-acp', pkg: '@agentclientprotocol/claude-agent-acp' },
};

function ensureAdapter(provider) {
  const adapter = ADAPTERS[provider];
  if (!adapter) return;
  try {
    execSync('command -v ' + adapter.bin, { stdio: 'ignore' });
  } catch {
    log('installing', adapter.pkg);
    execSync(
      'npm install -g ' +
        adapter.pkg +
        ' && ln -sf "$(npm prefix -g)/bin/' +
        adapter.bin +
        '" /usr/local/bin/',
      { stdio: 'ignore', timeout: 240_000 },
    );
  }
}

// --- ACP session (one agent process per task) --------------------------------

class Session {
  constructor(provider, taskKey, agentCommand) {
    this.provider = provider;
    this.taskKey = taskKey;
    // A custom command (fake agent in tests) brings its own binary — the
    // adapter bootstrap only applies to the stock provider CLIs.
    this.customCommand = Boolean(agentCommand);
    this.agentCommand = agentCommand || AGENT_COMMANDS[provider];
    this.actionsDir = ACTIONS_ROOT + '/' + taskKey;
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.briefed = false;
    this.onUpdate = null;
    this.activeTurn = null;
    this.lastUsedAt = Date.now();
  }

  ensureChild() {
    if (this.child) return;
    if (!this.customCommand) ensureAdapter(this.provider);
    mkdirSync(this.actionsDir, { recursive: true });
    const bootstrap =
      'export WB_ACTIONS_DIR=' + this.actionsDir + '; ' + this.agentCommand;
    this.child = spawn('sh', ['-c', bootstrap], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: WORKSPACE,
    });
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    // Agents log to stderr; keep a short tail in our log for debugging.
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) log('[' + this.provider + ':' + this.taskKey + ']', text.slice(0, 400));
    });
    this.child.on('exit', () => this.close());
    this.child.on('error', () => this.close());
  }

  onData(chunk) {
    this.buffer += String(chunk);
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      // Log lines share stdout with the protocol; only JSON frames are ours.
      if (!line.startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.onMessage(message);
    }
  }

  onMessage(message) {
    if (message.id != null && message.method === undefined) {
      const waiter = this.pending.get(message.id);
      if (waiter) {
        this.pending.delete(message.id);
        waiter.resolve(message);
      }
      return;
    }
    // Permission prompts auto-allow (headless), everything else declined.
    if (message.id != null && message.method === 'session/request_permission') {
      const options = (message.params && message.params.options) || [];
      const pick =
        options.find((option) => option.kind === 'allow_always') ||
        options.find((option) => option.kind === 'allow_once') ||
        options[0];
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          outcome: pick
            ? { outcome: 'selected', optionId: pick.optionId }
            : { outcome: 'cancelled' },
        },
      });
      return;
    }
    if (message.id != null) {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' },
      });
      return;
    }
    if (message.method === 'session/update') {
      const update = message.params && message.params.update;
      if (update && this.onUpdate) this.onUpdate(update);
    }
  }

  write(message) {
    if (!this.child) return;
    try {
      this.child.stdin.write(JSON.stringify(message) + '\n');
    } catch {
      /* pipe gone — exit handler tears the session down */
    }
  }

  call(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, timeoutMs || RPC_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  async ensureAcpSession() {
    if (this.child && this.sessionId) return;
    this.ensureChild();
    if (!this.sessionId) {
      const init = await this.call('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });
      if (init.error) {
        this.close();
        throw new Error('agent failed to initialize: ' + init.error.message);
      }
      const created = await this.call('session/new', {
        cwd: WORKSPACE,
        mcpServers: [],
      });
      if (created.error) {
        this.close();
        throw new Error(
          created.error.message === 'Authentication required'
            ? 'Provider is not signed in on the sandbox'
            : created.error.message,
        );
      }
      const sessionId = created.result && created.result.sessionId;
      if (typeof sessionId !== 'string') {
        this.close();
        throw new Error('agent returned no session id');
      }
      this.sessionId = sessionId;
      this.briefed = false;
    }
  }

  /**
   * One prompt turn. Queues behind the in-flight turn (a follow-up on the
   * same task waits rather than cancelling the work in progress).
   */
  async prompt(text, preamble, onUpdate, isCancelled) {
    this.lastUsedAt = Date.now();
    while (this.activeTurn) {
      await this.activeTurn.catch(() => {});
      if (isCancelled()) throw new Error('turn cancelled');
    }
    const turn = this.runTurn(text, preamble, onUpdate).finally(() => {
      this.activeTurn = null;
      this.onUpdate = null;
      this.lastUsedAt = Date.now();
    });
    this.activeTurn = turn;
    return turn;
  }

  async runTurn(text, preamble, onUpdate) {
    await this.ensureAcpSession();
    this.onUpdate = onUpdate;
    let message = text;
    if (!this.briefed && preamble) {
      message = preamble + '\n\n---\n\n' + text;
    }
    this.briefed = true;
    const response = await this.call(
      'session/prompt',
      { sessionId: this.sessionId, prompt: [{ type: 'text', text: message }] },
      TURN_TIMEOUT_MS,
    );
    if (response.error) {
      throw new Error(response.error.message || 'agent rejected the prompt');
    }
    const stopReason =
      response.result && typeof response.result.stopReason === 'string'
        ? response.result.stopReason
        : 'end_turn';
    return { stopReason };
  }

  cancel() {
    if (this.sessionId) {
      this.notify('session/cancel', { sessionId: this.sessionId });
    }
  }

  close() {
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error('agent connection closed'));
    }
    this.pending.clear();
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* already dead */
      }
    }
    this.child = null;
    this.sessionId = null;
    sessions.forEach((session, key) => {
      if (session === this) sessions.delete(key);
    });
  }
}

const sessions = new Map();

function getSession(provider, taskId, agentCommand) {
  const safeTask = String(taskId || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  const key = provider + ':' + safeTask;
  let session = sessions.get(key);
  if (!session) {
    session = new Session(provider, safeTask, agentCommand);
    sessions.set(key, session);
  }
  return session;
}

// --- Sync buffers -------------------------------------------------------------

/** Update batches waiting for the next sync: turnId → payload[]. */
const updateBuffers = new Map();
/** Per-turn batch cursor (survives across syncs, not restarts). */
const updateSeqs = new Map();
/** Browser-action requests not yet sent to the server. */
const outgoingActions = [];
/** Actions sent and awaiting a result: id → { turnId, actionsDir }. */
const awaitedActions = new Map();
/** Settles not yet sent. */
const outgoingSettles = [];
/** Settles sent and awaiting the server's verdict: turnId → resolver. */
const settleWaiters = new Map();
/** Turns this daemon is currently executing. */
const activeTurns = new Map();
/** Turn ids picked up but not yet acked as started. */
let startedTurnIds = [];

let lastWorkAt = Date.now();

function bufferUpdate(turnId, update) {
  let list = updateBuffers.get(turnId);
  if (!list) {
    list = [];
    updateBuffers.set(turnId, list);
  }
  list.push(update);
  // A runaway agent can chunk megabytes; cap the in-flight buffer.
  if (list.length > 500) list.splice(0, list.length - 500);
}

// --- Context mirror ------------------------------------------------------------

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Mirror extension scripts / report bodies the turn's manifest lists and
    this VM doesn't have yet. Best-effort: a miss costs the agent a
    readable file, never the turn. */
async function syncContext(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) return;
  try {
    const have = readManifest();
    const needExtensions = [];
    const needReports = [];
    for (const entry of manifest) {
      const key = entry.kind + ':' + entry.id;
      if (have[key] === entry.version) continue;
      if (entry.kind === 'extension') needExtensions.push(entry.id);
      else needReports.push(entry.id);
    }
    if (needExtensions.length === 0 && needReports.length === 0) return;
    const response = await fetch(SERVER + '/api/daemon/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TOKEN,
        extensions: needExtensions,
        reports: needReports,
      }),
    });
    if (!response.ok) return;
    const data = await response.json();
    mkdirSync(CONTEXT_DIR + '/extensions', { recursive: true });
    mkdirSync(CONTEXT_DIR + '/reports', { recursive: true });
    for (const ext of data.extensions || []) {
      writeFileSync(CONTEXT_DIR + '/extensions/' + ext.id + '.js', ext.script);
      have['extension:' + ext.id] = ext.version;
    }
    for (const report of data.reports || []) {
      writeFileSync(CONTEXT_DIR + '/reports/' + report.id + '.md', report.body);
      have['report:' + report.id] = report.version || 1;
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(have));
  } catch (error) {
    log('context sync failed:', String(error).slice(0, 200));
  }
}

// --- Turn execution -------------------------------------------------------------

function readOutcomeFile(path) {
  try {
    const raw = readFileSync(localPath(path), 'utf8');
    try {
      rmSync(localPath(path));
    } catch {
      /* consumed either way */
    }
    return raw;
  } catch {
    return null;
  }
}

/** Send a settle and wait for the server's verdict ({ok} or {retry}). */
function settleTurn(settle) {
  return new Promise((resolve) => {
    // If the server never answers (network hole), give up after 2 minutes —
    // the server's stale sweep will fail the turn row on its side.
    const timer = setTimeout(() => {
      settleWaiters.delete(settle.turnId);
      resolve({ ok: true });
    }, 120_000);
    settleWaiters.set(settle.turnId, (verdict) => {
      clearTimeout(timer);
      resolve(verdict);
    });
    outgoingSettles.push(settle);
  });
}

async function executeTurn(turnPayload) {
  const {
    id: turnId,
    taskId,
    provider,
    message,
    preamble,
    outcomePath,
    contextManifest,
    agentCommand,
  } = turnPayload;
  const record = { cancelled: false, session: null };
  activeTurns.set(turnId, record);
  lastWorkAt = Date.now();
  try {
    await syncContext(contextManifest);
    const session = getSession(provider, taskId, agentCommand);
    record.session = session;
    let reply = '';
    const onUpdate = (update) => {
      if (
        update.sessionUpdate === 'agent_message_chunk' &&
        update.content &&
        typeof update.content.text === 'string'
      ) {
        reply += update.content.text;
      }
      bufferUpdate(turnId, update);
    };

    const { stopReason } = await session.prompt(
      message,
      preamble,
      onUpdate,
      () => record.cancelled,
    );

    // Settle negotiation: the server validates the outcome file and may
    // ask for ONE corrective turn (rejected file, unbacked extension
    // claim). The daemon just relays; all policy lives server-side.
    let settle = {
      turnId,
      reply,
      stopReason,
      outcomeRaw: readOutcomeFile(outcomePath),
      retried: false,
    };
    for (let round = 0; round < 2; round++) {
      const verdict = await settleTurn(settle);
      if (!verdict || !verdict.retry || record.cancelled) break;
      let retryReply = '';
      try {
        const retry = await session.prompt(
          verdict.retry.message,
          null,
          (update) => {
            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content &&
              typeof update.content.text === 'string'
            ) {
              retryReply += update.content.text;
            }
            bufferUpdate(turnId, update);
          },
          () => record.cancelled,
        );
        settle = {
          turnId,
          reply: retryReply || reply,
          stopReason: retry.stopReason,
          outcomeRaw: readOutcomeFile(verdict.retry.outcomePath),
          retried: true,
        };
      } catch (error) {
        settle = {
          turnId,
          reply,
          stopReason,
          outcomeRaw: null,
          retried: true,
          error: String(error && error.message ? error.message : error),
        };
      }
    }
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    log('turn', turnId, 'failed:', text.slice(0, 300));
    await settleTurn({ turnId, error: text, retried: true });
  } finally {
    activeTurns.delete(turnId);
    lastWorkAt = Date.now();
  }
}

// --- Browser-action mailbox -------------------------------------------------------

/** Request files already relayed (avoid re-sending while unanswered). */
const seenActionFiles = new Set();

function scanActionMailboxes() {
  for (const [turnId, record] of activeTurns) {
    const session = record.session;
    if (!session) continue;
    let files;
    try {
      files = readdirSync(session.actionsDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.req.json')) continue;
      const id = file.slice(0, -'.req.json'.length);
      if (seenActionFiles.has(id)) continue;
      if (files.includes(id + '.res.json')) continue;
      let request;
      try {
        request = JSON.parse(
          readFileSync(session.actionsDir + '/' + file, 'utf8'),
        );
      } catch {
        continue; // torn write — the CLI just wrote it; next scan reads whole
      }
      seenActionFiles.add(id);
      awaitedActions.set(id, { turnId, actionsDir: session.actionsDir });
      outgoingActions.push({ turnId, action: request });
    }
  }
}

function deliverActionResult(id, result) {
  const awaited = awaitedActions.get(id);
  if (!awaited) return;
  awaitedActions.delete(id);
  seenActionFiles.delete(id);
  const path = awaited.actionsDir + '/' + id + '.res.json';
  try {
    writeFileSync(path + '.tmp', JSON.stringify(result));
    renameSync(path + '.tmp', path);
  } catch (error) {
    log('action result write failed:', String(error).slice(0, 200));
  }
}

// --- Main sync loop -----------------------------------------------------------------

let consecutiveSyncFailures = 0;

async function syncOnce() {
  scanActionMailboxes();

  const updates = [];
  for (const [turnId, list] of updateBuffers) {
    if (list.length === 0) continue;
    const seq = (updateSeqs.get(turnId) || 0) + 1;
    updateSeqs.set(turnId, seq);
    updates.push({ turnId, seq, updates: list.splice(0) });
  }
  const actions = outgoingActions.splice(0);
  const settles = outgoingSettles.splice(0);
  const started = startedTurnIds.splice(0);

  const body = {
    token: TOKEN,
    active: [...activeTurns.keys()],
    started,
    updates,
    actions,
    settles,
    pollActions: [...awaitedActions.keys()],
  };

  let data;
  try {
    const response = await fetch(SERVER + '/api/daemon/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      log('daemon token rejected; exiting');
      process.exit(1);
    }
    if (!response.ok) throw new Error('sync ' + response.status);
    data = await response.json();
    consecutiveSyncFailures = 0;
  } catch (error) {
    // Requeue what we tried to send; the buffers survive to the next tick.
    for (const batch of updates) {
      const list = updateBuffers.get(batch.turnId) || [];
      updateBuffers.set(batch.turnId, [...batch.updates, ...list]);
      updateSeqs.set(batch.turnId, (updateSeqs.get(batch.turnId) || 1) - 1);
    }
    outgoingActions.unshift(...actions);
    outgoingSettles.unshift(...settles);
    startedTurnIds.unshift(...started);
    consecutiveSyncFailures++;
    if (consecutiveSyncFailures > 200) {
      log('server unreachable for too long; exiting');
      process.exit(1);
    }
    return;
  }

  for (const verdictEntry of data.settleResults || []) {
    const waiter = settleWaiters.get(verdictEntry.turnId);
    if (waiter) {
      settleWaiters.delete(verdictEntry.turnId);
      waiter(verdictEntry);
    }
  }
  for (const entry of data.actionResults || []) {
    deliverActionResult(entry.id, entry.result);
  }
  for (const turnId of data.cancels || []) {
    const record = activeTurns.get(turnId);
    if (record && !record.cancelled) {
      record.cancelled = true;
      if (record.session) record.session.cancel();
    }
  }
  for (const turnPayload of data.turns || []) {
    if (activeTurns.has(turnPayload.id)) continue;
    startedTurnIds.push(turnPayload.id);
    lastWorkAt = Date.now();
    void executeTurn(turnPayload);
  }
}

async function main() {
  log('daemon up, pid', process.pid);
  mkdirSync(ACTIONS_ROOT, { recursive: true });
  mkdirSync(CONTEXT_DIR + '/extensions', { recursive: true });
  mkdirSync(CONTEXT_DIR + '/reports', { recursive: true });

  for (;;) {
    try {
      await syncOnce();
    } catch (error) {
      log('sync error:', String(error).slice(0, 300));
    }

    // Reap idle agent processes so the VM isn't kept busy by dead weight.
    for (const session of [...sessions.values()]) {
      if (
        !session.activeTurn &&
        Date.now() - session.lastUsedAt > SESSION_IDLE_MS
      ) {
        session.close();
      }
    }

    const busy =
      activeTurns.size > 0 ||
      outgoingSettles.length > 0 ||
      settleWaiters.size > 0;
    if (busy) lastWorkAt = Date.now();
    if (!busy && sessions.size === 0 && Date.now() - lastWorkAt > EXIT_AFTER_IDLE_MS) {
      log('idle; exiting so the VM can sleep');
      break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, busy ? SYNC_ACTIVE_MS : SYNC_IDLE_MS),
    );
  }
  try {
    unlinkSync(PID_PATH);
  } catch {
    /* already gone */
  }
  process.exit(0);
}

// Faster action pickup than the sync tick alone: scan the mailboxes on a
// short interval so the `browser` CLI never waits a full sync for relay.
setInterval(scanActionMailboxes, ACTION_SCAN_MS).unref();

process.on('uncaughtException', (error) => {
  log('uncaught:', String(error && error.stack ? error.stack : error));
  process.exit(1);
});

// Assets (skills, browser CLI) are fetched once per daemon version — the
// server bundles their content with the daemon's own version stamp.
async function ensureAssets() {
  const versionPath = DIR + '/assets.version';
  let have = '';
  try {
    have = readFileSync(versionPath, 'utf8').trim();
  } catch {
    /* first boot */
  }
  try {
    const response = await fetch(
      SERVER + '/api/daemon/assets?token=' + encodeURIComponent(TOKEN),
    );
    if (!response.ok) return;
    const data = await response.json();
    if (data.version === have) return;
    for (const file of data.files || []) {
      const path = localPath(file.path);
      const dir = path.slice(0, path.lastIndexOf('/'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, file.content);
      if (file.executable) chmodSync(path, 0o755);
      if (file.linkAs) {
        try {
          unlinkSync(file.linkAs);
        } catch {
          /* no previous link */
        }
        try {
          symlinkSync(path, file.linkAs);
        } catch (error) {
          log('symlink failed:', String(error).slice(0, 120));
        }
      }
    }
    writeFileSync(versionPath, data.version);
    log('assets updated to', data.version);
  } catch (error) {
    log('asset fetch failed:', String(error).slice(0, 200));
  }
}

await ensureAssets();
await main();
