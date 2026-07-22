import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContextChips } from '@web-butler/ui';
import { useMemo, useState } from 'react';
import { SAMPLE_ELEMENTS } from './sample-data';

const meta = {
  title: 'Shell/ContextChips',
  component: ContextChips,
} satisfies Meta<typeof ContextChips>;

export default meta;
type Story = StoryObj;

function ContextChipsDemo() {
  const [elements, setElements] = useState(SAMPLE_ELEMENTS);
  const missingIds = useMemo(() => new Set(['story-2']), []);
  return (
    <div className="webbutler:flex webbutler:flex-col webbutler:items-end webbutler:gap-2">
      <ContextChips
        elements={elements}
        missingIds={missingIds}
        onRemove={(id) =>
          setElements((current) => current.filter((el) => el.id !== id))
        }
        onHover={() => {}}
        onJump={(el) => console.log('[storybook] jump', el.label)}
      />
      <button
        type="button"
        onClick={() => setElements(SAMPLE_ELEMENTS)}
        className="webbutler:cursor-pointer webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border)] webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-ink)] webbutler:hover:bg-[var(--wc-hover-1)]"
      >
        Reset chips
      </button>
      <p className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
        second chip is in the “missing from page” state
      </p>
    </div>
  );
}

export const Default: Story = {
  render: () => <ContextChipsDemo />,
};
