import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  DEFAULT_SETTINGS,
  ProvidersView,
  type ProviderAuth,
  type Settings,
} from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/ProvidersView',
  component: ProvidersView,
} satisfies Meta<typeof ProvidersView>;

export default meta;
type Story = StoryObj;

/** Simulated shell: Connect → starting → device code → connected (8s). */
function useFakeDeviceAuth(
  fixed: ProviderAuth | undefined,
  code: string,
  verificationUrl: string,
) {
  const [live, setLive] = useState<ProviderAuth>(
    fixed ?? { status: 'disconnected' },
  );
  const connect = () => {
    setLive({ status: 'starting' });
    window.setTimeout(
      () =>
        setLive({
          status: 'pending',
          userCode: code,
          verificationUrl,
          expiresAt: Date.now() + 15 * 60_000,
        }),
      900,
    );
    window.setTimeout(() => setLive({ status: 'connected' }), 9000);
  };
  return {
    auth: fixed ?? live,
    connect: fixed ? undefined : connect,
  };
}

function ProvidersViewDemo({
  codex,
  grok,
  claude,
}: {
  codex?: ProviderAuth;
  grok?: ProviderAuth;
  claude?: ProviderAuth;
}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const codexAuth = useFakeDeviceAuth(
    codex,
    'K4AC-8RTH9',
    'https://auth.openai.com/codex/device',
  );
  const grokAuth = useFakeDeviceAuth(
    grok,
    'Z9Z2-VK8F',
    'https://accounts.x.ai/oauth2/device?user_code=Z9Z2-VK8F',
  );
  // Claude's reverse flow: pending has a URL but no code; pasting one back
  // "verifies" and connects after a moment.
  const [claudeLive, setClaudeLive] = useState<ProviderAuth>(
    claude ?? { status: 'disconnected' },
  );
  const claudeConnect = () => {
    setClaudeLive({ status: 'starting' });
    window.setTimeout(
      () =>
        setClaudeLive({
          status: 'pending',
          verificationUrl: 'https://claude.com/cai/oauth/authorize?code=true',
        }),
      900,
    );
  };
  return (
    <div
      style={{ width: 400, height: 230 }}
      className="webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)]"
    >
      <ProvidersView
        settings={settings}
        onChange={(patch) =>
          setSettings((current) => ({ ...current, ...patch }))
        }
        codex={codexAuth.auth}
        onCodexConnect={codexAuth.connect}
        grok={grokAuth.auth}
        onGrokConnect={grokAuth.connect}
        claude={claude ?? claudeLive}
        onClaudeConnect={claude ? undefined : claudeConnect}
        onClaudeSubmitCode={() =>
          window.setTimeout(() => setClaudeLive({ status: 'connected' }), 1200)
        }
      />
    </div>
  );
}

/** Click Connect on either row: starting → device code (9s) → connected. */
export const Default: Story = {
  render: () => <ProvidersViewDemo />,
};

/**
 * Statuses still being fetched from the server: every row reads
 * "Checking…" (pulsing) instead of a Connect button that might flip to
 * Connected a beat later.
 */
export const Loading: Story = {
  render: () => (
    <ProvidersViewDemo
      codex={{ status: 'unknown' }}
      grok={{ status: 'unknown' }}
      claude={{ status: 'unknown' }}
    />
  ),
};

export const GrokPending: Story = {
  render: () => (
    <ProvidersViewDemo
      codex={{ status: 'connected' }}
      grok={{
        status: 'pending',
        userCode: 'Z9Z2-VK8F',
        verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=Z9Z2-VK8F',
      }}
    />
  ),
};

export const CodePending: Story = {
  render: () => (
    <ProvidersViewDemo
      codex={{
        status: 'pending',
        userCode: 'K4AC-8RTH9',
        verificationUrl: 'https://auth.openai.com/codex/device',
      }}
    />
  ),
};

export const Connected: Story = {
  render: () => <ProvidersViewDemo codex={{ status: 'connected' }} />,
};

/**
 * Connected providers form a radio group: the accent dot marks the ACTIVE
 * one and slides between rows. Click "Connected" on the other row to switch.
 */
export const ActiveProviderSwitch: Story = {
  render: () => (
    <ProvidersViewDemo
      codex={{ status: 'connected' }}
      grok={{ status: 'connected' }}
      claude={{ status: 'connected' }}
    />
  ),
};

export const Failed: Story = {
  render: () => (
    <ProvidersViewDemo
      codex={{ status: 'failed', error: 'Connection failed. Try again.' }}
    />
  ),
};
