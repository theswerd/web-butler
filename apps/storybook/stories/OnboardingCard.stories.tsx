import type { Meta, StoryObj } from '@storybook/react-vite';
import { OnboardingCard, type ProviderAuth } from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/OnboardingCard',
  component: OnboardingCard,
} satisfies Meta<typeof OnboardingCard>;

export default meta;
type Story = StoryObj;

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 560 }}>{children}</div>;
}

/**
 * The full simulated journey: Sign in with ChatGPT → the pill morphs to
 * "Getting your code…" → code blooms in after ~1s → "signs in" by itself
 * 8s later → done step.
 */
function LiveDemo() {
  const [codex, setCodex] = useState<ProviderAuth>({ status: 'disconnected' });
  const [finished, setFinished] = useState(false);

  const connect = () => {
    setCodex({ status: 'starting' });
    window.setTimeout(
      () =>
        setCodex({
          status: 'pending',
          userCode: 'K4AC-8RTH9',
          verificationUrl: 'https://auth.openai.com/codex/device',
          expiresAt: Date.now() + 15 * 60_000,
        }),
      1000,
    );
    window.setTimeout(() => setCodex({ status: 'connected' }), 9000);
  };

  if (finished) {
    return (
      <p style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
        Onboarding finished. (Reload the story to run it again.)
      </p>
    );
  }

  return (
    <Frame>
      <OnboardingCard
        codex={codex}
        onConnect={connect}
        onDone={() => setFinished(true)}
      />
    </Frame>
  );
}

export const LiveFlow: Story = {
  render: () => <LiveDemo />,
};

/**
 * The required permissions step: the provider connects while Chrome's
 * "Allow User Scripts" switch is off, so onboarding holds there. Click
 * "Open extension settings" to simulate flipping the switch — the card
 * advances to done on its own (in the real shell it polls Chrome).
 */
function PermissionsDemo() {
  const [codex, setCodex] = useState<ProviderAuth>({ status: 'disconnected' });
  const [userScripts, setUserScripts] = useState(false);
  const [finished, setFinished] = useState(false);

  const connect = () => {
    setCodex({ status: 'starting' });
    window.setTimeout(() => setCodex({ status: 'connected' }), 1200);
  };

  if (finished) {
    return (
      <p style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
        Onboarding finished. (Reload the story to run it again.)
      </p>
    );
  }

  return (
    <Frame>
      <OnboardingCard
        codex={codex}
        onConnect={connect}
        userScriptsEnabled={userScripts}
        onOpenUserScriptsSettings={() =>
          window.setTimeout(() => setUserScripts(true), 1500)
        }
        onDone={() => setFinished(true)}
      />
    </Frame>
  );
}

export const PermissionsStep: Story = {
  render: () => <PermissionsDemo />,
};

export const Welcome: Story = {
  render: () => (
    <Frame>
      <OnboardingCard
        codex={{ status: 'disconnected' }}
        onConnect={() => {}}
        onDone={() => {}}
      />
    </Frame>
  ),
};

function AtConnectStep({ codex }: { codex: ProviderAuth }) {
  // Storybook-only: click "Get set up" is internal state, so this wrapper
  // can't jump steps — instead these stories start with the auth already
  // in the target state and the reviewer clicks through.
  return (
    <Frame>
      <OnboardingCard codex={codex} onConnect={() => {}} onDone={() => {}} />
    </Frame>
  );
}

/** Click "Sign in with ChatGPT" to see the device code screen. */
export const CodePending: Story = {
  render: () => (
    <AtConnectStep
      codex={{
        status: 'pending',
        userCode: 'K4AC-8RTH9',
        verificationUrl: 'https://auth.openai.com/codex/device',
        expiresAt: Date.now() + 15 * 60_000,
      }}
    />
  ),
};

/**
 * The tab IS the verification page: "Open sign-in page" grays out into a
 * you're-here marker while the code stays copyable.
 */
export const OnSignInPage: Story = {
  render: () => (
    <Frame>
      <OnboardingCard
        isThisPage={() => true}
        codex={{
          status: 'pending',
          userCode: 'K4AC-8RTH9',
          verificationUrl: 'https://auth.openai.com/codex/device',
          expiresAt: Date.now() + 15 * 60_000,
        }}
        onConnect={() => {}}
        onDone={() => {}}
      />
    </Frame>
  ),
};

/**
 * Claude's reverse flow: click "Sign in with Claude" — no code to show;
 * instead a paste box waits for the code Anthropic gives the user.
 */
export const ClaudeCodePaste: Story = {
  render: () => {
    function Demo() {
      const [claude, setClaude] = useState<ProviderAuth>({
        status: 'pending',
        verificationUrl: 'https://claude.com/cai/oauth/authorize?code=true',
      });
      return (
        <Frame>
          <OnboardingCard
            codex={{ status: 'disconnected' }}
            claude={claude}
            onConnect={() => {}}
            onSubmitCode={() =>
              window.setTimeout(() => setClaude({ status: 'connected' }), 1500)
            }
            onDone={() => {}}
          />
        </Frame>
      );
    }
    return <Demo />;
  },
};

/** Click "Sign in with ChatGPT" to see the failure state. */
export const Failed: Story = {
  render: () => (
    <AtConnectStep
      codex={{ status: 'failed', error: 'Could not reach the sandbox.' }}
    />
  ),
};

/**
 * The post-setup reauth gate when the sign-in fails: alongside "Try
 * again" and "Not now", "Switch provider" bails out to the Providers
 * view — this provider may just be the wrong one now.
 */
export const GateFailed: Story = {
  render: () => (
    <Frame>
      <OnboardingCard
        variant="gate"
        codex={{ status: 'failed', error: 'Could not reach the sandbox.' }}
        onConnect={() => {}}
        onSkip={() => {}}
        onSwitchProvider={() => {}}
        onDone={() => {}}
      />
    </Frame>
  ),
};
