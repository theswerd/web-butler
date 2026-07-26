import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { ACCENT, MONO } from './brand';

const LEN = 34;
const STROKE = 5;

const Corner: React.FC<{ rot: number; pos: React.CSSProperties }> = ({
  rot,
  pos,
}) => (
  <span
    style={{
      position: 'absolute',
      width: LEN,
      height: LEN,
      borderLeft: `${STROKE}px solid ${ACCENT}`,
      borderTop: `${STROKE}px solid ${ACCENT}`,
      borderTopLeftRadius: 6,
      rotate: `${rot}deg`,
      ...pos,
    }}
  />
);

/**
 * The extension's own highlight language: camera-corner brackets that
 * snap around the payoff region, wearing a label pill. Corners fly in
 * from outside; the pill pops last.
 */
export const CornerFocus: React.FC<{
  at: number;
  label: string;
  rect: { left: number; top: number; width: number; height: number };
}> = ({ at, label, rect }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0) return null;

  const p = interpolate(t, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.22, 1.35, 0.4, 1),
  });
  // Corners converge from 22px outside their resting spots.
  const gap = (1 - p) * 22;
  const pill = interpolate(t, [6, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        opacity: p,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <Corner rot={0} pos={{ left: -gap, top: -gap }} />
      <Corner rot={90} pos={{ right: -gap, top: -gap }} />
      <Corner rot={270} pos={{ left: -gap, bottom: -gap }} />
      <Corner rot={180} pos={{ right: -gap, bottom: -gap }} />
      <span
        style={{
          position: 'absolute',
          top: -21,
          left: 26,
          translate: '0 -100%',
          backgroundColor: ACCENT,
          color: '#fff',
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 24,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '8px 18px',
          borderRadius: 999,
          scale: String(pill),
          transformOrigin: 'bottom left',
          display: 'inline-block',
        }}
      >
        {label}
      </span>
    </div>
  );
};
