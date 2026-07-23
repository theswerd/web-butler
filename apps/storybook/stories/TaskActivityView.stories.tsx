import type { Meta, StoryObj } from '@storybook/react-vite';
import { TaskActivityView } from '@web-butler/ui';
import type { Task, TaskUpdate } from '@web-butler/ui';
import { useEffect, useState } from 'react';

const meta = {
  title: 'Report/TaskActivityView',
  component: TaskActivityView,
} satisfies Meta<typeof TaskActivityView>;

export default meta;
type Story = StoryObj;

/** Side-panel width, side-panel height. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 360,
        height: 480,
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

const RUNNING: Task = {
  id: 'task-1',
  scope: 'global',
  prompt: 'Research the top 5 CRM tools and compare pricing',
  url: 'https://example.com/pricing',
  status: 'running',
  startedAt: Date.now() - 42_000,
  seen: true,
};

const FEED: TaskUpdate[] = [
  { at: Date.now() - 40_000, kind: 'thought', text: 'The user wants a pricing comparison. I should check each vendor\u2019s pricing page directly rather than rely on summaries.' },
  { at: Date.now() - 36_000, kind: 'tool', text: 'Fetch https://www.salesforce.com/pricing' },
  { at: Date.now() - 30_000, kind: 'tool', text: 'Fetch https://www.hubspot.com/pricing/crm' },
  { at: Date.now() - 24_000, kind: 'thought', text: 'HubSpot hides seat minimums behind the Professional tier; noting that as a caveat.' },
  { at: Date.now() - 18_000, kind: 'tool', text: 'Fetch https://www.pipedrive.com/pricing' },
  { at: Date.now() - 9_000, kind: 'message', text: 'So far: **Salesforce** starts at $25/user/mo (Starter), **HubSpot** has a free tier but Professional jumps to $90/user/mo with a 3-seat minimum, and **Pipedrive** lands in between at $14\u2013$99.' },
];

export const Running: Story = {
  render: () => (
    <Frame>
      <TaskActivityView task={RUNNING} updates={FEED} />
    </Frame>
  ),
};

export const JustStarted: Story = {
  render: () => (
    <Frame>
      <TaskActivityView
        task={{ ...RUNNING, startedAt: Date.now() - 2_000 }}
        updates={[]}
      />
    </Frame>
  ),
};

export const SettledDone: Story = {
  render: () => (
    <Frame>
      <TaskActivityView
        task={{
          ...RUNNING,
          status: 'done',
          finishedAt: Date.now() - 60_000,
          outcome: 'Comparison ready: HubSpot cheapest to start, Salesforce most complete.',
          reportId: 'report-1',
          suggestions: [
            'Draft an email recommending HubSpot to the team',
            'Add Zoho and Monday to the comparison',
            'Watch these pricing pages for changes',
          ],
        }}
        updates={FEED}
        onOpenReport={() => console.log('[storybook] open report')}
        onUseSuggestion={(text) => console.log('[storybook] suggest:', text)}
      />
    </Frame>
  ),
};

/** A task whose outputs are BOTH a report and an extension — the report
    button leads, the extension button seconds it. */
export const WithBothOutputs: Story = {
  render: () => (
    <Frame>
      <TaskActivityView
        task={{
          ...RUNNING,
          prompt: 'Hide sponsored posts and write up what you removed',
          status: 'done',
          finishedAt: Date.now() - 60_000,
          outcome: 'Installed "Hide sponsored posts"',
          reportId: 'report-1',
          extensionId: 'ext-1',
          suggestions: ['Do the same on LinkedIn'],
        }}
        updates={FEED.slice(0, 4)}
        onOpenReport={() => console.log('[storybook] open report')}
        onOpenExtension={() => console.log('[storybook] open extension')}
        onUseSuggestion={(text) => console.log('[storybook] suggest:', text)}
      />
    </Frame>
  ),
};

/** Extension-only output: its button wears the accent. */
export const WithExtensionOutput: Story = {
  render: () => (
    <Frame>
      <TaskActivityView
        task={{
          ...RUNNING,
          prompt: 'Always hide the cookie banner on this site',
          status: 'done',
          finishedAt: Date.now() - 60_000,
          outcome: 'Installed "Hide cookie banner"',
          extensionId: 'ext-1',
        }}
        updates={FEED.slice(0, 3)}
        onOpenExtension={() => console.log('[storybook] open extension')}
      />
    </Frame>
  ),
};

export const Failed: Story = {
  render: () => (
    <Frame>
      <TaskActivityView
        task={{
          ...RUNNING,
          status: 'failed',
          finishedAt: Date.now() - 30_000,
          outcome: 'The agent hit a rate limit before finishing.',
        }}
        updates={FEED.slice(0, 3)}
      />
    </Frame>
  ),
};

/** Simulated stream: a new feed line lands every second, then it settles. */
function LiveDemo() {
  const [count, setCount] = useState(1);
  const done = count >= FEED.length + 2;
  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(() => setCount((current) => current + 1), 1000);
    return () => window.clearTimeout(id);
  }, [count, done]);
  const task: Task = done
    ? {
        ...RUNNING,
        status: 'done',
        finishedAt: Date.now(),
        outcome: 'Comparison ready.',
      }
    : RUNNING;
  return (
    <Frame>
      <TaskActivityView task={task} updates={FEED.slice(0, count)} />
    </Frame>
  );
}

export const LiveStream: Story = {
  render: () => <LiveDemo />,
};
