import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AgentHighlight,
  AnswerCard,
  resolveHighlight,
  type AgentHighlightStyle,
  type PageHighlight,
} from '@web-butler/ui';
import { useState } from 'react';

/**
 * The agent's highlight tool: marker overlays over page sections it
 * flagged, each with a short markdown note, navigated via `highlight:`
 * links in the answer markdown. Markers wear the user's selected theme
 * accent (`accent` prop); the shape language — brackets + labeled pill —
 * is what says "the agent marked this", not the color.
 *
 * The per-concept stories below are a restyling exploration: same
 * behavior, different chrome. Each stage shows one FOCUSED marker (note
 * card open) and one resting marker; the note's ✕ dismisses the marker
 * for good.
 */
const meta = {
  title: 'Shell/AgentHighlight',
  component: AgentHighlight,
} satisfies Meta<typeof AgentHighlight>;

export default meta;
type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* Concept stages: one focused + one resting marker over a small page. */
/* ------------------------------------------------------------------ */

const STAGE_HIGHLIGHTS: PageHighlight[] = [
  {
    id: 'tos',
    selector: '#stage-tos',
    label: 'Auto-renewal',
    note: 'This clause opts you into **auto-renewal** — the cancel window is only *14 days* from signup.',
  },
  {
    id: 'email',
    selector: '#stage-email',
    label: 'Unvalidated field',
    note: 'This field is client-side validated only: the form posts whatever string is in it.',
  },
];

function ConceptStage({
  variant,
  accent = '#3b82f6',
}: {
  variant: AgentHighlightStyle;
  /** The user-selected theme accent; blue is the extension default. */
  accent?: string;
}) {
  const [items, setItems] = useState(STAGE_HIGHLIGHTS);
  const [focusedId, setFocusedId] = useState<string | null>('tos');

  return (
    <div
      style={{
        padding: '56px 48px 40px',
        fontFamily: 'system-ui, sans-serif',
        color: '#333',
      }}
    >
      <div
        id="stage-tos"
        style={{
          maxWidth: 520,
          padding: '16px 20px',
          border: '1px solid #ddd',
          borderRadius: 10,
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        By continuing you agree to our terms of service, including the
        arbitration clause and the auto-renewal of your subscription at the
        then-current rate.
      </div>

      <div style={{ height: 158 }} />

      <form
        onSubmit={(e) => e.preventDefault()}
        style={{ display: 'flex', gap: 8, maxWidth: 520 }}
      >
        <input
          id="stage-email"
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

      {items.map((highlight, index) => (
        <AgentHighlight
          key={highlight.id}
          variant={variant}
          accent={accent}
          index={index}
          highlight={highlight}
          focused={focusedId === highlight.id}
          onFocusToggle={() =>
            setFocusedId((current) =>
              current === highlight.id ? null : highlight.id,
            )
          }
          onDismiss={() => {
            setItems((current) =>
              current.filter((entry) => entry.id !== highlight.id),
            );
            setFocusedId((current) =>
              current === highlight.id ? null : current,
            );
          }}
        />
      ))}
    </div>
  );
}

/** Camera-viewfinder brackets — chrome only at the corners, a rounded-
    square handle, and a dark HUD note card. */
export const Corners: Story = {
  render: () => <ConceptStage variant="corners" />,
};

/** Corners' viewfinder brackets with Tag's labeled pill as the handle —
    the dark HUD note drops from the pill. */
export const CornersTag: Story = {
  render: () => <ConceptStage variant="corners-tag" />,
};

/** Hairline outline with a numbered label pill riding the top edge (the
    homepage's chip-on-top language); note drops from the pill with a
    caret. */
export const Tag: Story = {
  render: () => <ConceptStage variant="tag" />,
};

/** Sketched dashed outline — annotation, not UI — paired with a sticky-
    note paper card. */
export const Dashed: Story = {
  render: () => <ConceptStage variant="dashed" />,
};

/** Borderless soft spotlight that breathes while focused; smallest
    resting footprint of the set. */
export const Glow: Story = {
  render: () => <ConceptStage variant="glow" />,
};

/** The original look (full border + wash) with the redesigned note card,
    for comparison. */
export const Classic: Story = {
  render: () => <ConceptStage variant="classic" />,
};

/* ------------------------------------------------------------------ */
/* The whole loop, unchanged: answer chips scroll to and focus markers. */
/* ------------------------------------------------------------------ */

const HIGHLIGHTS: PageHighlight[] = [
  {
    id: 'pricing',
    selector: '#sb-pricing',
    label: 'SSO pricing',
    note: 'The **Team** row is the only plan with SSO — the other two hide it behind "Contact sales".',
  },
  {
    id: 'email-field',
    selector: '#sb-email',
    label: 'Email field',
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
 * note. Markers dismiss from the note's ✕. Pick a variant from the
 * controls toolbar via the stories above; this demo runs one concept.
 */
export const FullLoop: Story = {
  render: function HighlightDemo() {
    const [items, setItems] = useState(HIGHLIGHTS);
    const [focusedId, setFocusedId] = useState<string | null>(null);

    const jump = (id: string) => {
      const target = items.find((h) => h.id === id);
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
        {items.map((highlight, index) => (
          <AgentHighlight
            key={highlight.id}
            variant="corners-tag"
            accent="#3b82f6"
            index={index}
            highlight={highlight}
            focused={focusedId === highlight.id}
            onFocusToggle={() =>
              setFocusedId((current) =>
                current === highlight.id ? null : highlight.id,
              )
            }
            onDismiss={() => {
              setItems((current) =>
                current.filter((entry) => entry.id !== highlight.id),
              );
              setFocusedId((current) =>
                current === highlight.id ? null : current,
              );
            }}
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
            // The shell root sets this in the extension; the answer's
            // highlight chips read it so they match the markers.
            ['--wc-selection' as string]: '#3b82f6',
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
