import './env';
import { getFreestyle } from './freestyle';
import type { PtySession } from 'freestyle';
import { EXTENSION_SKILL, SKILL_PATH } from './extension-skill';
import {
  ACTIONS_DIR,
  BROWSER_CLI,
  BROWSER_CLI_PATH,
  BROWSER_SKILL_PATH,
  BROWSER_TOOL_SKILL,
} from './browser-tool';

/**
 * Generic ACP (Agent Client Protocol) bridge to the agent CLIs on a user's
 * sandbox VM.
 *
 * All three providers speak ACP — JSON-RPC over stdio: Grok natively
 * (`grok agent stdio`), Codex and Claude through the official adapters
 * (`codex-acp`, `claude-agent-acp`), which reuse the CLI credentials the
 * device-login flows already put on the VM. The transport is a Freestyle
 * PTY session: the PTY opens the VM's default shell, which turns off echo
 * (a PTY would otherwise feed our own frames back into the parser) and
 * execs the agent. From there it's newline-delimited JSON both ways; the
 * agents' human-readable log lines land on the same stream and are
 * filtered out by the parser.
 *
 * One bridge per (vm, provider, task), kept alive between prompts so each
 * task's session carries its own conversation context across follow-up
 * messages — and so several tasks can run turns at the same time, each in
 * its own agent process. Idle bridges are reaped so a held websocket
 * doesn't keep a VM billable forever.
 */

export type AcpProvider = 'codex' | 'grok' | 'claude';

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

/** One `session/update` notification's payload — forwarded verbatim. */
export type AcpUpdate = Record<string, unknown>;

import { WORKSPACE_DIR } from './vm-paths';
export { WORKSPACE_DIR };

/**
 * Created together with the workspace: turn outcome files (butler.ts) and
 * the page-extension authoring skill (extension-skill.ts).
 */
const PREP_DIRS =
  `${WORKSPACE_DIR} ${WORKSPACE_DIR}/.butler ${ACTIONS_DIR} ` +
  `${WORKSPACE_DIR}/skills/page-extension ` +
  `${WORKSPACE_DIR}/skills/browser-control`;

/**
 * The shell line that becomes the agent process. `stty raw -echo` first:
 * raw mode stops the PTY from translating newlines, no-echo stops it from
 * mirroring our writes. (The PTY API rejects `exec` strings with quotes,
 * so the bootstrap is written to the shell instead.)
 *
 * WB_ACTIONS_DIR: each task's agent gets its own browser-action mailbox
 * (the `browser` CLI inherits the env). Without it, two concurrent tasks
 * would drain each other's actions into the wrong tab.
 */
const AGENT_COMMANDS: Record<AcpProvider, string> = {
  grok: 'exec grok --no-auto-update agent stdio',
  // NO_BROWSER: the adapter must not advertise browser-based auth on a VM.
  codex: 'export NO_BROWSER=1; exec codex-acp',
  claude: 'exec claude-agent-acp',
};

function bootstrapFor(provider: AcpProvider, actionsDir: string): string {
  return (
    `stty raw -echo; export WB_ACTIONS_DIR=${actionsDir}; ` +
    `mkdir -p ${actionsDir}; ${AGENT_COMMANDS[provider]}\n`
  );
}

/**
 * Codex and Claude need their ACP adapters installed. Newer snapshots bake
 * them in (scripts/build-snapshot.ts); VMs created from older snapshots get
 * them lazily here, the first time the provider is used.
 */
const ADAPTERS: Partial<Record<AcpProvider, { bin: string; pkg: string }>> = {
  codex: { bin: 'codex-acp', pkg: '@agentclientprotocol/codex-acp' },
  claude: { bin: 'claude-agent-acp', pkg: '@agentclientprotocol/claude-agent-acp' },
};

/** A finished prompt turn. `text` is the concatenated agent message. */
export type AcpTurn = { stopReason: string };

const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const RPC_TIMEOUT_MS = 60 * 1000;
/** Bridges unused this long get closed (the VM can then stop when idle). */
const IDLE_TTL_MS = 5 * 60 * 1000;

class AcpBridge {
  private session: PtySession | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (msg: JsonRpcMessage) => void; reject: (err: Error) => void }
  >();
  private acpSessionId: string | null = null;
  /** The in-flight turn's update sink; null between prompts. */
  private onUpdate: ((update: AcpUpdate) => void) | null = null;
  private activeTurn: Promise<AcpTurn> | null = null;
  /**
   * Standing instructions prepended to the first turn of every ACP session
   * (agent CLIs have no separate system-prompt channel). Survives session
   * teardown — a rebuilt session gets re-briefed.
   */
  private preamble: string | null = null;
  private briefed = false;
  lastUsedAt = Date.now();

  constructor(
    private readonly vmId: string,
    private readonly provider: AcpProvider,
    /** This task's private browser-action mailbox on the VM. */
    readonly actionsDir: string,
  ) {}

  /**
   * Set the standing instructions for this bridge. Delivered at the top of
   * the next turn that starts a fresh ACP session (and again after any
   * session rebuild) — the agents have no separate system-prompt channel.
   */
  setPreamble(text: string) {
    this.preamble = text;
  }

  /**
   * Run one prompt turn. Updates stream to `onUpdate` as the agent works;
   * resolves with the stop reason when the turn ends. A turn already in
   * flight is NOT cancelled — this bridge is one task's conversation, so a
   * newer message is a follow-up and queues behind the current turn (the
   * user adding guidance mid-task shouldn't kill the work in progress).
   * Cancellation is explicit: the caller's `signal`, or cancel().
   */
  async prompt(
    text: string,
    onUpdate: (update: AcpUpdate) => void,
    signal?: AbortSignal,
  ): Promise<AcpTurn> {
    this.lastUsedAt = Date.now();

    // Queue: each waiter re-checks, so back-to-back follow-ups run in
    // arrival order (near enough — exact FIFO doesn't matter here).
    while (this.activeTurn) {
      await this.activeTurn.catch(() => {});
      // A follow-up that was aborted while waiting shouldn't still run.
      if (signal?.aborted) throw new Error('turn cancelled');
    }

    const turn = this.runTurn(text, onUpdate, signal).finally(() => {
      this.activeTurn = null;
      this.onUpdate = null;
      this.lastUsedAt = Date.now();
    });
    this.activeTurn = turn;
    return turn;
  }

  /** Cancel the in-flight turn (the user hit stop on this task). */
  cancel() {
    if (this.acpSessionId) {
      this.notify('session/cancel', { sessionId: this.acpSessionId });
    }
  }

  private async runTurn(
    text: string,
    onUpdate: (update: AcpUpdate) => void,
    signal?: AbortSignal,
  ): Promise<AcpTurn> {
    await this.ensureSession();
    this.onUpdate = onUpdate;

    // First turn of a session carries the briefing above the message.
    let message = text;
    if (!this.briefed && this.preamble) {
      message = `${this.preamble}\n\n---\n\n${text}`;
    }
    this.briefed = true;

    const onAbort = () => {
      this.notify('session/cancel', { sessionId: this.acpSessionId });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.call(
        'session/prompt',
        {
          sessionId: this.acpSessionId,
          prompt: [{ type: 'text', text: message }],
        },
        TURN_TIMEOUT_MS,
      );
      if (response.error) {
        throw new Error(response.error.message || 'agent rejected the prompt');
      }
      const stopReason =
        typeof response.result?.stopReason === 'string'
          ? response.result.stopReason
          : 'end_turn';
      return { stopReason };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** PTY open → bootstrap → initialize → session/new, each step memoized. */
  private async ensureSession(): Promise<void> {
    if (this.session && this.acpSessionId) return;
    await this.ensureAgent();

    const newSession = await this.call('session/new', {
      cwd: WORKSPACE_DIR,
      mcpServers: [],
    });
    if (newSession.error) {
      // The one expected failure: CLI not signed in on this VM.
      this.close();
      throw new Error(
        newSession.error.message === 'Authentication required'
          ? 'Provider is not signed in on the sandbox'
          : newSession.error.message,
      );
    }
    const sessionId = newSession.result?.sessionId;
    if (typeof sessionId !== 'string') {
      this.close();
      throw new Error('agent returned no session id');
    }
    this.acpSessionId = sessionId;
    this.briefed = false; // fresh session — deliver the preamble again
  }

  private async ensureAgent(): Promise<void> {
    if (this.session) return;

    const vm = getFreestyle().vms.ref({ vmId: this.vmId });

    // A stopped VM refuses PTY websockets until it's back up; exec both
    // starts it and confirms readiness. Also the moment for lazy installs.
    const adapter = ADAPTERS[this.provider];
    const prep = adapter
      ? `mkdir -p ${PREP_DIRS}; command -v ${adapter.bin} >/dev/null || ` +
        `{ npm install -g ${adapter.pkg} && ` +
        `ln -sf "$(npm prefix -g)/bin/${adapter.bin}" /usr/local/bin/; }`
      : `mkdir -p ${PREP_DIRS}`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const result = await vm.exec({ command: prep, timeoutMs: 180_000 });
        if (result.statusCode === 0) {
          lastError = null;
          break;
        }
        lastError = new Error(result.stderr || 'VM prep failed');
      } catch (error) {
        lastError = error; // still booting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));

    // The authoring contracts + browser CLI, where the briefing points.
    // Overwritten every boot so updates reach existing VMs. The CLI is
    // symlinked onto PATH and made executable so the agent runs `browser`.
    await Promise.all([
      vm.fs.writeTextFile(SKILL_PATH, EXTENSION_SKILL),
      vm.fs.writeTextFile(BROWSER_SKILL_PATH, BROWSER_TOOL_SKILL),
      vm.fs.writeTextFile(BROWSER_CLI_PATH, BROWSER_CLI),
    ]);
    await vm.exec({
      command:
        `chmod +x ${BROWSER_CLI_PATH} && ` +
        `ln -sf ${BROWSER_CLI_PATH} /usr/local/bin/browser`,
      timeoutMs: 30_000,
    });

    this.session = await vm.pty.open({
      // Wide so the PTY never wraps a JSON frame across "screen" lines.
      cols: 8000,
      rows: 50,
      onData: (data) => this.onData(data),
      onExit: () => this.close(),
      onClose: () => this.close(),
      onError: () => this.close(),
    });
    this.session.write(bootstrapFor(this.provider, this.actionsDir));

    const init = await this.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        // The agent works on the VM's own filesystem; nothing to proxy.
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    if (init.error) {
      this.close();
      throw new Error(`agent failed to initialize: ${init.error.message}`);
    }
  }

  private onData(data: Uint8Array) {
    this.buffer += new TextDecoder().decode(data);
    let index: number;
    while ((index = this.buffer.search(/[\r\n]/)) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      // The agents' log lines share the PTY with the protocol; only JSON
      // frames are ours.
      if (!line.startsWith('{')) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // torn or non-protocol JSON — skip
      }
      this.onMessage(message);
    }
  }

  private onMessage(message: JsonRpcMessage) {
    // Response to one of our calls.
    if (message.id != null && message.method === undefined) {
      this.pending.get(message.id)?.resolve(message);
      this.pending.delete(message.id);
      return;
    }

    // Request FROM the agent. The only expected one is the permission
    // prompt; a headless bridge always allows (prefer the sticky option so
    // the agent stops asking). Anything else is politely declined.
    if (message.id != null && message.method === 'session/request_permission') {
      const options = (message.params?.options ?? []) as Array<{
        optionId: string;
        kind?: string;
      }>;
      const pick =
        options.find((option) => option.kind === 'allow_always') ??
        options.find((option) => option.kind === 'allow_once') ??
        options[0];
      this.respond(message.id, {
        outcome: pick
          ? { outcome: 'selected', optionId: pick.optionId }
          : { outcome: 'cancelled' },
      });
      return;
    }
    if (message.id != null) {
      this.session?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found' },
        }) + '\n',
      );
      return;
    }

    // Notification. Turn progress goes to the active prompt's sink.
    if (message.method === 'session/update') {
      const update = message.params?.update as AcpUpdate | undefined;
      if (update) this.onUpdate?.(update);
    }
  }

  private call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
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
      this.session?.write(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
      );
    });
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.session?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private respond(id: number | string, result: Record<string, unknown>) {
    this.session?.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  /** Tear down; the next prompt rebuilds from scratch. */
  close() {
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error('agent connection closed'));
    }
    this.pending.clear();
    try {
      this.session?.detach();
    } catch {
      /* websocket already gone */
    }
    this.session = null;
    this.acpSessionId = null;
    bridges.forEach((bridge, key) => {
      if (bridge === this) bridges.delete(key);
    });
  }
}

const bridges = new Map<string, AcpBridge>();

/**
 * The bridge for one task's conversation. Same (vm, provider, task) →
 * same agent process and ACP session, so follow-up messages land with the
 * task's full context; different tasks get their own process and can run
 * concurrently. Task ids are client-supplied — sanitized here because the
 * id becomes a directory name on the VM.
 */
export function getAcpBridge(
  vmId: string,
  provider: AcpProvider,
  taskId?: string,
): AcpBridge {
  const safeTask = (taskId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  const key = `${vmId}:${provider}:${safeTask}`;
  let bridge = bridges.get(key);
  if (!bridge) {
    bridge = new AcpBridge(vmId, provider, `${ACTIONS_DIR}/${safeTask}`);
    bridges.set(key, bridge);
  }
  return bridge;
}

// Reap idle bridges so their websockets don't pin VMs awake. unref: the
// interval must never keep the server process alive on its own.
setInterval(() => {
  for (const bridge of bridges.values()) {
    if (Date.now() - bridge.lastUsedAt > IDLE_TTL_MS) bridge.close();
  }
}, 60_000).unref();
