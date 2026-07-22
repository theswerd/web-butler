import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArtifactsView, type Report } from '@web-butler/ui';

/**
 * The Artifacts menu view: every long-form result of the session — reports,
 * drafts, extracted data — with a name and one-line description. Clicking a
 * row opens it in the Chrome side panel (ReportView).
 */
const meta = {
  title: 'Shell/Artifacts',
  component: ArtifactsView,
} satisfies Meta<typeof ArtifactsView>;

export default meta;
type Story = StoryObj;

const now = Date.now();

const SAMPLE_ARTIFACTS: Report[] = [
  {
    id: 'a1',
    title: 'Draft: ready to send',
    description: 'Email draft from the background research, ready to send.',
    meta: 'example.com · 5:12 PM',
    text: 'Subject: **Following up**\n\nHi…',
    createdAt: now - 90 * 1000,
  },
  {
    id: 'a2',
    title: 'Pricing table',
    description: 'All three tiers extracted as markdown, annual rates.',
    meta: 'example.com · 4:40 PM',
    text: '| Plan | Price |',
    createdAt: now - 35 * 60 * 1000,
  },
  {
    id: 'a3',
    title: 'Research notes',
    description: 'Positioning, pricing, and momentum findings, with sources.',
    meta: 'example.com · 2:03 PM',
    text: 'Ran the background research…',
    createdAt: now - 3 * 60 * 60 * 1000,
  },
];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ width: 400, height: 180 }}
      className="webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)]"
    >
      {children}
    </div>
  );
}

export const List: Story = {
  render: () => (
    <Frame>
      <ArtifactsView
        artifacts={SAMPLE_ARTIFACTS}
        onOpen={(artifact) => console.log('[storybook] open:', artifact.title)}
      />
    </Frame>
  ),
};

export const Empty: Story = {
  render: () => (
    <Frame>
      <ArtifactsView artifacts={[]} />
    </Frame>
  ),
};
