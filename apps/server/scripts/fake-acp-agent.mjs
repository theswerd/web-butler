#!/usr/bin/env node
// A minimal ACP agent for the local end-to-end probe (e2e-probe.mjs).
// Speaks newline-delimited JSON-RPC on stdio like the real provider CLIs:
// initialize → session/new → session/prompt. Each prompt streams a couple
// of agent_message_chunk updates, writes the outcome file the turn message
// names, and (when the prompt asks) exercises the browser-action mailbox
// by writing a request file and waiting for the daemon's response file.
//
// Path convention: the server speaks canonical VM paths (/root/workspace);
// WB_WORKSPACE (set by the probe, inherited from the daemon) rebases them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const VM_WORKSPACE = '/root/workspace';
const WORKSPACE = process.env.WB_WORKSPACE || VM_WORKSPACE;
const ACTIONS_DIR = process.env.WB_ACTIONS_DIR || null;

const localPath = (path) =>
  path.startsWith(VM_WORKSPACE) ? WORKSPACE + path.slice(VM_WORKSPACE.length) : path;

const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');

const notifyChunk = (sessionId, text) =>
  send({
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drop an action request in the mailbox and wait for the daemon to write
    the response file — exactly what the real `browser` CLI does. */
async function runBrowserAction() {
  if (!ACTIONS_DIR) return { ok: false, error: 'no actions dir' };
  mkdirSync(ACTIONS_DIR, { recursive: true });
  const id = randomUUID();
  const request = { id, kind: 'read' };
  writeFileSync(`${ACTIONS_DIR}/${id}.req.json.tmp`, JSON.stringify(request));
  writeFileSync(`${ACTIONS_DIR}/${id}.req.json`, JSON.stringify(request));
  const resPath = `${ACTIONS_DIR}/${id}.res.json`;
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    if (existsSync(resPath)) {
      return JSON.parse(readFileSync(resPath, 'utf8'));
    }
  }
  return { ok: false, error: 'action timed out' };
}

async function handlePrompt(id, params) {
  const sessionId = params.sessionId;
  const text = (params.prompt || [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n');

  notifyChunk(sessionId, 'Thinking about it… ');
  await sleep(150);

  let browserResult = null;
  if (text.includes('PROBE_BROWSER_ACTION')) {
    browserResult = await runBrowserAction();
  }

  // The turn message names the outcome file to write.
  const match = text.match(/\/root\/workspace\/\.butler\/outcome-[a-f0-9-]+\.json/);
  const reply = browserResult
    ? `Browser action answered: ${JSON.stringify(browserResult)}`
    : 'Hello from the fake agent.';
  notifyChunk(sessionId, reply);

  if (match && !text.includes('PROBE_SKIP_OUTCOME')) {
    writeFileSync(
      localPath(match[0]),
      JSON.stringify([{ type: 'response', markdown: reply }]),
    );
  }

  send({ id, result: { stopReason: 'end_turn' } });
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += String(chunk);
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const { id, method, params } = message;
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
    } else if (method === 'session/new') {
      send({ id, result: { sessionId: `fake-${randomUUID()}` } });
    } else if (method === 'session/prompt') {
      void handlePrompt(id, params);
    } else if (method === 'session/cancel') {
      // notification — nothing to do
    } else if (id != null) {
      send({ id, error: { code: -32601, message: 'Method not found' } });
    }
  }
});
