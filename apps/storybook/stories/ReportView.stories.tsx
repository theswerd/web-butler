import type { Meta, StoryObj } from '@storybook/react-vite';
import { ANSWER_FIXTURES, ReportView } from '@web-butler/ui';

/**
 * Rendered inside a mock Chrome side panel frame: 360px wide, full height,
 * hard edge on the left where it meets the page. This is where every
 * 'artifact'-tier result lands — in-page they only get a handoff card.
 */
const meta = {
  title: 'Side panel/ReportView',
  component: ReportView,
} satisfies Meta<typeof ReportView>;

export default meta;
type Story = StoryObj;

function SidePanelFrame({ fixtureId }: { fixtureId: string }) {
  const fixture = ANSWER_FIXTURES.find((f) => f.id === fixtureId)!;
  return (
    <div
      style={{ width: 360, height: 560 }}
      className="webbutler:overflow-hidden webbutler:rounded-lg webbutler:border webbutler:border-[var(--wc-border)] webbutler:shadow-lg"
    >
      <ReportView
        title={fixture.title ?? 'Report'}
        meta="example.com · 4:12 PM"
        text={fixture.text}
      />
    </div>
  );
}

export const PricingTable: Story = {
  render: () => <SidePanelFrame fixtureId="artifact-pricing-table" />,
};

export const Userscript: Story = {
  render: () => <SidePanelFrame fixtureId="artifact-userscript" />,
};

export const EmailDraft: Story = {
  render: () => <SidePanelFrame fixtureId="artifact-support-email" />,
};
