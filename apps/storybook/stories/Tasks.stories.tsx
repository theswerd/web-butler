import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  DEFAULT_SETTINGS,
  MenuPanel,
  TaskToast,
  TasksView,
  type Settings,
  type Task,
  type ViewId,
} from '@web-butler/ui';
import { useState } from 'react';

/**
 * The session's activity list: every run, ongoing or finished, tab-scoped
 * or global. Ongoing rows lead with a pulsing dot; finished rows lead with
 * the outcome, with the original ask kept in the subline. A task finishing
 * off-tab additionally toasts (TaskToast) in every tab.
 */
const meta = {
  title: 'Shell/Tasks',
  component: TasksView,
} satisfies Meta<typeof TasksView>;

export default meta;
type Story = StoryObj;

const now = Date.now();

const SAMPLE_TASKS: Task[] = [
  {
    id: 't1',
    scope: 'global',
    prompt: 'research the top 3 competitors and summarize their pricing',
    url: 'https://example.com',
    status: 'running',
    startedAt: now - 90 * 1000,
    seen: true,
  },
  {
    id: 't2',
    scope: 'tab',
    prompt: 'what does the fine print on this pricing page actually say?',
    url: 'https://example.com/pricing',
    status: 'running',
    startedAt: now - 20 * 1000,
    seen: true,
  },
  {
    id: 't3',
    scope: 'global',
    prompt: 'draft an email to Priya about the Acme findings',
    url: 'https://example.com',
    status: 'done',
    startedAt: now - 6 * 60 * 1000,
    finishedAt: now - 40 * 1000,
    outcome: 'Email draft ready',
    reportId: 'r1',
    seen: false,
  },
  {
    id: 't4',
    scope: 'tab',
    prompt: 'summarize this article',
    url: 'https://example.com/blog',
    status: 'done',
    startedAt: now - 22 * 60 * 1000,
    finishedAt: now - 20 * 60 * 1000,
    outcome: 'The article argues the pricing change is defensive, not greedy.',
    seen: true,
  },
  {
    id: 't4b',
    scope: 'tab',
    prompt: 'always hide the cookie banner on this site',
    url: 'https://example.com',
    status: 'done',
    startedAt: now - 45 * 60 * 1000,
    finishedAt: now - 44 * 60 * 1000,
    outcome: 'Installed "Cookie banner hider"',
    extensionId: 'e1',
    seen: true,
  },
  {
    id: 't5',
    scope: 'global',
    prompt: 'watch this page and tell me when the price drops below $200',
    url: 'https://example.com/product',
    status: 'failed',
    startedAt: now - 3 * 60 * 60 * 1000,
    finishedAt: now - 3 * 60 * 60 * 1000 + 30_000,
    outcome: 'Provider is not signed in on the sandbox',
    seen: true,
  },
  {
    id: 't6',
    scope: 'tab',
    prompt: 'translate this page to German',
    url: 'https://example.com',
    status: 'stopped',
    startedAt: now - 26 * 60 * 60 * 1000,
    finishedAt: now - 26 * 60 * 60 * 1000 + 5_000,
    seen: true,
  },
];

export const ListInMenu: Story = {
  render: () => <MenuWithTasks />,
};

function MenuWithTasks() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [active, setActive] = useState<ViewId>('tasks');
  // Stateful so trash/clear behave like the real thing.
  const [tasks, setTasks] = useState<Task[]>(SAMPLE_TASKS);
  return (
    <div style={{ width: 560 }}>
      <MenuPanel
        active={active}
        onSelect={setActive}
        settings={settings}
        onSettingsChange={(patch) =>
          setSettings((current) => ({ ...current, ...patch }))
        }
        tasks={tasks}
        onOpenReport={(task) => console.log('open report', task.reportId)}
        onOpenTask={(task) => console.log('open task', task.id)}
        onTaskRetry={(task) => console.log('retry', task.prompt)}
        onTaskRemove={(task) =>
          setTasks((current) => current.filter((row) => row.id !== task.id))
        }
        onTasksClear={(mode) =>
          setTasks((current) =>
            mode === 'old'
              ? current.filter((row) => row.status === 'running')
              : [],
          )
        }
      />
    </div>
  );
}

export const EmptyList: Story = {
  render: () => (
    <div
      style={{ width: 400, height: 180 }}
      className="webbutler:overflow-hidden webbutler:rounded-[20px] webbutler:border webbutler:border-[var(--wc-border)] webbutler:bg-[var(--wc-surface)]"
    >
      <TasksView tasks={[]} />
    </div>
  ),
};

export const Toast: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <TaskToast
        task={SAMPLE_TASKS[2]}
        onOpen={() => console.log('open tasks')}
        onDismiss={() => console.log('dismissed')}
      />
    </div>
  ),
};

export const FailedToast: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <TaskToast
        task={SAMPLE_TASKS[4]}
        onOpen={() => console.log('open tasks')}
        onDismiss={() => console.log('dismissed')}
      />
    </div>
  ),
};
