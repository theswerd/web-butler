import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ContextChips,
  DEFAULT_SETTINGS,
  MenuPanel,
  TaskStrip,
  TaskToast,
  TasksView,
  type Settings,
  type SiteExtension,
  type Task,
  type ViewId,
} from '@web-butler/ui';
import { useState } from 'react';
import { SAMPLE_ELEMENTS } from './sample-data';

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
    activity: 'Reading acme.com/pricing',
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

// Installed extensions behind the t4b row's puzzle chip — clicking it
// must land on Extensions with "Cookie banner hider" (e1) flashed, not
// just the view.
const SAMPLE_EXTENSIONS: SiteExtension[] = [
  {
    id: 'e0',
    name: 'Rainbow post titles',
    description: 'Cycles post titles through rainbow colors on the blog.',
    urlPatterns: ['*://example.com/blog*'],
    script: '',
    stage: 'document_idle',
    version: 1,
    enabled: true,
    createdAt: now - 60 * 60 * 1000,
    updatedAt: now - 60 * 60 * 1000,
  },
  {
    id: 'e1',
    name: 'Cookie banner hider',
    description: 'Hides the cookie consent banner on example.com.',
    urlPatterns: ['*://example.com/*'],
    script: '',
    stage: 'document_idle',
    version: 1,
    enabled: true,
    createdAt: now - 44 * 60 * 1000,
    updatedAt: now - 44 * 60 * 1000,
  },
  {
    id: 'e2',
    name: 'Hide profile images',
    description: 'Hides avatars across the forum.',
    urlPatterns: ['*://forum.example.com/*'],
    script: '',
    stage: 'document_idle',
    version: 1,
    enabled: false,
    createdAt: now - 2 * 60 * 60 * 1000,
    updatedAt: now - 2 * 60 * 60 * 1000,
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
        tasks={{
          items: tasks,
          onOpenReport: (task) => console.log('open report', task.reportId),
          onOpenTask: (task) => console.log('open task', task.id),
          onRetry: (task) => console.log('retry', task.prompt),
          onRemove: (task) =>
            setTasks((current) => current.filter((row) => row.id !== task.id)),
          onClear: (mode) =>
            setTasks((current) =>
              mode === 'old'
                ? current.filter((row) => row.status === 'running')
                : [],
            ),
        }}
        extensions={{
          state: {
            extensions: SAMPLE_EXTENSIONS,
            userScriptsAvailable: true,
          },
        }}
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

// The compact per-task rows that dock with the prompt box: one running
// with a live activity line, one selected (the next message replies to
// it), one failed, one finished but not yet seen. Clicking a row body
// toggles the reference; stop/dismiss mutate the list like the shell.
const STRIP_TASKS: Task[] = [
  {
    id: 's1',
    scope: 'global',
    prompt: 'research the top 3 competitors and summarize their pricing',
    url: 'https://example.com',
    status: 'running',
    startedAt: now - 90 * 1000,
    seen: true,
    activity: 'Reading acme.com/pricing',
  },
  {
    id: 's2',
    scope: 'tab',
    prompt: 'draft an email to Priya about the Acme findings',
    url: 'https://example.com',
    status: 'running',
    startedAt: now - 30 * 1000,
    seen: true,
    activity: 'Writing the draft',
  },
  {
    id: 's3',
    scope: 'global',
    prompt: 'watch this page and tell me when the price drops below $200',
    url: 'https://example.com/product',
    status: 'failed',
    startedAt: now - 4 * 60 * 1000,
    finishedAt: now - 60 * 1000,
    outcome: 'Provider is not signed in on the sandbox',
    seen: true,
  },
  {
    id: 's4',
    scope: 'tab',
    prompt: 'summarize this article',
    url: 'https://example.com/blog',
    status: 'done',
    startedAt: now - 8 * 60 * 1000,
    finishedAt: now - 2 * 60 * 1000,
    outcome: 'The article argues the pricing change is defensive.',
    seen: false,
  },
];

export const Strip: Story = {
  render: () => <StripDemo />,
};

function StripDemo() {
  const [tasks, setTasks] = useState<Task[]>(STRIP_TASKS);
  // s2 starts referenced, matching the "replying to this task" state.
  const [selectedId, setSelectedId] = useState<string | null>('s2');
  return (
    // TaskStrip renders `display: contents`; in the shell its pills share
    // a wrap row with the element chips, so the story provides that row.
    <div
      style={{ width: 560 }}
      className="webbutler:flex webbutler:flex-wrap webbutler:items-center webbutler:gap-1"
    >
      <TaskStrip
        tasks={tasks}
        selectedId={selectedId}
        onSelect={(task) =>
          setSelectedId((current) => (current === task.id ? null : task.id))
        }
        onOpen={(task) => console.log('open transcript', task.id)}
        onCancel={(task) =>
          setTasks((current) =>
            current.map((row) =>
              row.id === task.id
                ? { ...row, status: 'stopped', finishedAt: Date.now() }
                : row,
            ),
          )
        }
        onDismiss={(task) =>
          setTasks((current) => current.filter((row) => row.id !== task.id))
        }
      />
    </div>
  );
}

/** The shell's real arrangement: task pills and picked-element chips
    sharing one wrap row — pills from the left, chips finishing the line
    on the right. */
export const StripWithChips: Story = {
  render: () => <StripWithChipsDemo />,
};

function StripWithChipsDemo() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div
      style={{ width: 560 }}
      className="webbutler:flex webbutler:flex-wrap webbutler:items-center webbutler:gap-1"
    >
      <TaskStrip
        tasks={STRIP_TASKS.slice(0, 1)}
        selectedId={selectedId}
        onSelect={(task) =>
          setSelectedId((current) => (current === task.id ? null : task.id))
        }
        onOpen={(task) => console.log('open transcript', task.id)}
        onCancel={(task) => console.log('cancel', task.id)}
        onDismiss={(task) => console.log('dismiss', task.id)}
      />
      <div className="webbutler:ml-auto webbutler:min-w-0">
        <ContextChips
          elements={SAMPLE_ELEMENTS.slice(0, 2)}
          missingIds={new Set<string>()}
          onHover={() => {}}
          onJump={() => {}}
          onRemove={() => {}}
        />
      </div>
    </div>
  );
}

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
