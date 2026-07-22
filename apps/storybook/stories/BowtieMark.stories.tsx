import type { Meta, StoryObj } from '@storybook/react-vite';
import { BowtieMark } from '@web-butler/ui';

const meta = {
  title: 'Shell/BowtieMark',
  component: BowtieMark,
} satisfies Meta<typeof BowtieMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
  render: () => (
    <div className="webbutler:flex webbutler:items-end webbutler:gap-6 webbutler:text-[var(--wc-ink)]">
      {[15, 24, 48].map((size) => (
        <div
          key={size}
          className="webbutler:flex webbutler:flex-col webbutler:items-center webbutler:gap-2"
        >
          <BowtieMark size={size} />
          <span className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
            {size}px
          </span>
        </div>
      ))}
    </div>
  ),
};

/**
 * The working loop: wings pull apart, flip 180°, and snap back in —
 * repeating. This is the busy signal on both the collapsed pill and the
 * open shell's menu button.
 */
export const Working: Story = {
  render: () => (
    <div className="webbutler:flex webbutler:items-end webbutler:gap-6 webbutler:text-[var(--wc-ink)]">
      {[15, 24, 48].map((size) => (
        <div
          key={size}
          className="webbutler:flex webbutler:flex-col webbutler:items-center webbutler:gap-2"
        >
          <BowtieMark size={size} working />
          <span className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
            {size}px
          </span>
        </div>
      ))}
    </div>
  ),
};

export const AccentKnot: Story = {
  render: () => (
    <div className="webbutler:flex webbutler:flex-col webbutler:items-center webbutler:gap-2 webbutler:text-[var(--wc-ink)]">
      <BowtieMark size={48} knot="var(--wc-selection)" />
      <span className="webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
        accent knot (toolbar accent applies)
      </span>
    </div>
  ),
};
