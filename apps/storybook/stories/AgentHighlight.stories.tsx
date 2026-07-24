import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AgentHighlight,
  AnswerCard,
  resolveHighlight,
  type PageHighlight,
} from '@web-butler/ui';
import { useState } from 'react';

/**
 * The agent's highlight tool: marker overlays over page sections it
 * flagged, each with a short markdown note, navigated via `highlight:`
 * links in the answer markdown. Amber on purpose — the theme accent
 * belongs to what the USER picked; the marker language is the agent's.
 */
const meta = {
  title: 'Shell/AgentHighlight',
  component: AgentHighlight,
} satisfies Meta<typeof AgentHighlight>;

export default meta;
type Story = StoryObj;

const HIGHLIGHTS: PageHighlight[] = [
  {
    id: 'pricing',
    selector: '#sb-pricing',
    note: 'The **Team** row is the only plan with SSO — the other two hide it behind "Contact sales".',
  },
  {
    id: 'email-field',
    selector: '#sb-email',
    note: 'This field is *client-side validated only*: the form posts whatever string is in it.',
  },
];

const ANSWER = `Two things worth your attention on this page: [the pricing table](highlight:pricing) buries SSO in the Team tier, and the signup form's [email field](highlight:email-field) accepts anything.`;

/** A fake page tall enough that jumping to a highlight actually scrolls. */
function FakePage() {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '32px 24px 360px',
        fontFamily: 'system-ui, sans-serif',
        color: '#333',
      }}
    >
      <h1 style={{ fontSize: 26 }}>Acme Cloud — Plans</h1>
      <p style={{ lineHeight: 1.6 }}>
        Everything you need to ship, from solo side projects to enterprise
        fleets. All plans include unlimited deploys and a global CDN.
      </p>
      <p style={{ lineHeight: 1.6, color: '#777' }}>
        Scroll on — the interesting parts are marked below. The answer card at
        the bottom links to them.
      </p>
      <div style={{ height: 320 }} />
      <table
        id="sb-pricing"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
      >
        <thead>
          <tr>
            {['Plan', 'Price', 'Seats', 'SSO'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid #ddd',
                  padding: '8px 10px',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ['Hobby', '$0', '1', '—'],
            ['Pro', '$20/mo', '5', 'Contact sales'],
            ['Team', '$99/mo', '25', 'Included'],
          ].map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  style={{ borderBottom: '1px solid #eee', padding: '8px 10px' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ height: 380 }} />
      <h2 style={{ fontSize: 18 }}>Get started</h2>
      <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', gap: 8 }}>
        <input
          id="sb-email"
          placeholder="you@company.com"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #ccc',
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#111',
            color: '#fff',
          }}
        >
          Sign up
        </button>
      </form>
    </div>
  );
}

/**
 * The whole loop: an answer with `highlight:` link chips, marker overlays
 * over the flagged sections, click a chip to scroll there and open the
 * note. The corner tab on each marker toggles its note by hand; nothing
 * scrolls until a link is clicked.
 */
export const Demo: Story = {
  render: function HighlightDemo() {
    const [focusedId, setFocusedId] = useState<string | null>(null);

    const jump = (id: string) => {
      const target = HIGHLIGHTS.find((h) => h.id === id);
      if (!target) return;
      setFocusedId(id);
      resolveHighlight(target)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    };

    return (
      <>
        <FakePage />
        {HIGHLIGHTS.map((highlight) => (
          <AgentHighlight
            key={highlight.id}
            highlight={highlight}
            focused={focusedId === highlight.id}
            onFocusToggle={() =>
              setFocusedId((current) =>
                current === highlight.id ? null : highlight.id,
              )
            }
          />
        ))}
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 520,
            maxWidth: '90vw',
          }}
        >
          <AnswerCard
            tier="answer"
            text={ANSWER}
            onHighlightLink={jump}
            onDismiss={() => console.log('[storybook] dismiss')}
          />
        </div>
      </>
    );
  },
};

/** A single focused marker with its note card open. */
export const FocusedMarker: Story = {
  render: function FocusedMarkerDemo() {
    const [focused, setFocused] = useState(true);
    return (
      <div style={{ padding: '80px 60px' }}>
        <div
          id="sb-focused-target"
          style={{
            maxWidth: 420,
            padding: '18px 20px',
            border: '1px solid #ddd',
            borderRadius: 10,
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          By continuing you agree to our terms of service, including the
          arbitration clause and the auto-renewal of your subscription.
        </div>
        <AgentHighlight
          highlight={{
            id: 'tos',
            selector: '#sb-focused-target',
            note: 'This is the clause that opts you into **auto-renewal** — the cancel window is only 14 days.',
          }}
          focused={focused}
          onFocusToggle={() => setFocused((f) => !f)}
        />
      </div>
    );
  },
};
