/**
 * Builds the default sandbox snapshot: a Freestyle VM with the three agent
 * CLIs preinstalled — Claude Code (`claude`), Codex (`codex`), and xAI's
 * Grok Build (`grok`). Prints the snapshot id to put in .env as
 * FREESTYLE_SNAPSHOT_ID; /api/init then creates every user VM from it.
 *
 *   npm run snapshot:build   (from apps/server)
 */
import '../src/env';
import { getFreestyle } from '../src/freestyle';

const freestyle = getFreestyle();

/** exec with echo + failure on non-zero exit. */
async function run(vm: Awaited<ReturnType<typeof freestyle.vms.create>>['vm'], command: string, timeoutMs = 300_000) {
  console.log(`\n$ ${command}`);
  const result = await vm.exec({ command, timeoutMs });
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (result.statusCode !== 0) {
    throw new Error(`command failed (${result.statusCode}): ${command}`);
  }
  return result.stdout ?? '';
}

console.log('Creating builder VM…');
const { vm, vmId } = await freestyle.vms.create({ name: 'snapshot-builder' });
console.log(`builder: ${vmId}`);

try {
  // Node for the npm-distributed CLIs (install if the base image lacks it).
  try {
    await run(vm, 'node --version && npm --version');
  } catch {
    await run(
      vm,
      'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs',
    );
  }

  // The CLIs plus their ACP adapters (grok speaks ACP natively; codex and
  // claude go through the official agentclientprotocol adapters, which the
  // server drives over a PTY — see src/acp.ts).
  await run(
    vm,
    'npm install -g @anthropic-ai/claude-code @openai/codex ' +
      '@agentclientprotocol/codex-acp @agentclientprotocol/claude-agent-acp',
  );
  // npm's global bin dir isn't on the PATH of non-interactive shells (which
  // is also how agents will exec) — link the CLIs somewhere that always is.
  await run(
    vm,
    'ln -sf "$(npm prefix -g)/bin/claude" "$(npm prefix -g)/bin/codex" ' +
      '"$(npm prefix -g)/bin/codex-acp" "$(npm prefix -g)/bin/claude-agent-acp" ' +
      '/usr/local/bin/',
  );

  // Grok Build ships a curl installer (no npm package); it lands in the
  // user's home, so link it somewhere on the non-interactive PATH.
  await run(vm, 'curl -fsSL https://x.ai/cli/install.sh | bash');
  await run(
    vm,
    'for d in "$HOME/.local/bin" "$HOME/.grok/bin" "$HOME/bin"; do ' +
      '[ -x "$d/grok" ] && ln -sf "$d/grok" /usr/local/bin/grok; done; true',
  );

  console.log('\nVerifying installs…');
  await run(vm, 'claude --version');
  await run(vm, 'codex --version');
  await run(vm, 'grok --version');

  console.log('\nSnapshotting…');
  const { snapshotId } = await vm.snapshot({ name: 'web-butler-default' });

  // Wait for the snapshot to finish building before declaring success.
  for (let i = 0; i < 120; i++) {
    const snapshot = await freestyle.vms.snapshots.get({ snapshotId });
    if (snapshot.state === 'ready') break;
    if (snapshot.state === 'failed' || snapshot.state === 'lost') {
      throw new Error(`snapshot ${snapshotId} ${snapshot.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log(`\nSnapshot ready: ${snapshotId}`);
  console.log(`Add to apps/server/.env:\n\nFREESTYLE_SNAPSHOT_ID=${snapshotId}`);
} finally {
  console.log(`\nDeleting builder VM ${vmId}…`);
  await freestyle.vms.delete({ vmId }).catch((error) => {
    console.warn(`builder delete failed (delete ${vmId} manually):`, error);
  });
}
