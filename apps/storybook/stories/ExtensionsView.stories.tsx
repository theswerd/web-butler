import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ExtensionsView,
  RepairToast,
  type ExtensionHealth,
  type SiteExtension,
} from '@web-butler/ui';
import { useState } from 'react';

const meta = {
  title: 'Shell/ExtensionsView',
  component: ExtensionsView,
} satisfies Meta<typeof ExtensionsView>;

export default meta;
type Story = StoryObj;

const now = Date.now();

const SAMPLE: SiteExtension[] = [
  {
    id: 'ext-1',
    name: 'Hide YouTube Shorts',
    description: 'Removes the Shorts shelf and sidebar entry everywhere.',
    urlPatterns: ['*://*.youtube.com/*'],
    script: 'webButler.register({ apply() {}, remove() {} });',
    stage: 'document_idle',
    enabled: true,
    version: 3,
    createdAt: now - 86_400_000 * 4,
    updatedAt: now - 3_600_000,
  },
  {
    id: 'ext-2',
    name: 'Dense GitHub PR lists',
    description: 'Tighter rows and no avatars on pull request pages.',
    urlPatterns: ['*://github.com/*/pulls*', '*://github.com/*/issues*'],
    script: 'webButler.register({ apply() {}, remove() {} });',
    stage: 'document_idle',
    enabled: true,
    version: 1,
    createdAt: now - 86_400_000 * 2,
    updatedAt: now - 86_400_000 * 2,
  },
  {
    id: 'ext-3',
    name: 'Calm news mode',
    description: 'Hides trending panels and comment counts on both sites.',
    urlPatterns: ['*://*.reddit.com/*', '*://news.ycombinator.com/*'],
    script: 'webButler.register({ apply() {}, remove() {} });',
    stage: 'document_start',
    enabled: false,
    version: 2,
    createdAt: now - 86_400_000 * 12,
    updatedAt: now - 86_400_000 * 6,
  },
];

function Demo({
  extensions,
  userScriptsAvailable = true,
  health,
  pageUrl,
}: {
  extensions: SiteExtension[];
  userScriptsAvailable?: boolean;
  health?: Record<string, ExtensionHealth>;
  pageUrl?: string;
}) {
  const [list, setList] = useState(extensions);
  return (
    <div
      style={{ width: 400, height: 230 }}
      className="webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)]"
    >
      <ExtensionsView
        state={{ extensions: list, userScriptsAvailable, health }}
        onToggle={(id, enabled) =>
          setList((current) =>
            current.map((ext) => (ext.id === id ? { ...ext, enabled } : ext)),
          )
        }
        onDelete={(id) =>
          setList((current) => current.filter((ext) => ext.id !== id))
        }
        pageUrl={pageUrl}
        onFix={(ext, reason) => console.log('fix', ext.id, reason)}
      />
    </div>
  );
}

/** Toggle switches live; delete appears on row hover. */
export const Default: Story = {
  render: () => <Demo extensions={SAMPLE} />,
};

export const Empty: Story = {
  render: () => <Demo extensions={[]} />,
};

/** Chrome's user-scripts toggle is off — the list shows how to enable it. */
export const NeedsChromeToggle: Story = {
  render: () => <Demo extensions={SAMPLE} userScriptsAvailable={false} />,
};

/**
 * With a page URL the view gains the "This page / All" filter, landing on
 * the contextual list when anything matches.
 */
export const PageFilter: Story = {
  render: () => (
    <Demo
      extensions={SAMPLE}
      pageUrl="https://github.com/webbutler/webbutler/pulls"
    />
  ),
};

/**
 * A script's self-check failed (the site changed under it): the row shows
 * the diagnosis and a Fix button that hands the repair to the agent.
 */
export const BrokenExtension: Story = {
  render: () => (
    <Demo
      extensions={SAMPLE}
      pageUrl="https://www.youtube.com/feed"
      health={{
        'ext-1': {
          status: 'broken',
          reason: 'no element matches [aria-label=Shorts]',
          url: 'https://www.youtube.com/feed',
          at: now - 30_000,
        },
        'ext-2': { status: 'ok', at: now - 3_600_000 },
      }}
    />
  ),
};

/**
 * The proactive ask: shown at the dock the moment an extension reports
 * itself broken on the current page, once per broken version.
 */
export const RepairAsk: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <RepairToast
        extension={SAMPLE[0]}
        reason="no element matches [aria-label=Shorts]"
        onFix={() => console.log('fix')}
        onDismiss={() => console.log('dismiss')}
      />
    </div>
  ),
};
