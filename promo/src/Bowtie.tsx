import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { ACCENT, INK } from './brand';

/**
 * The Web Butler bowtie. `spin` replays the extension's working
 * animation: the wings orbit around the knot and snap into place.
 */
export const Bowtie: React.FC<{
  size: number;
  ink?: string;
  knot?: string;
  from?: number;
  still?: boolean;
}> = ({ size, ink = INK, knot = ACCENT, from = 0, still = false }) => {
  const frame = useCurrentFrame();
  const t = still ? 1000 : frame - from;

  const orbit = interpolate(t, [0, 22], [-180, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 1.25, 0.4, 1),
  });
  const opacity = interpolate(t, [0, 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const knotScale = interpolate(t, [12, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.34, 1.6, 0.64, 1),
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ opacity }}
    >
      <g style={{ transform: `rotate(${orbit}deg)`, transformOrigin: '12px 12px' }}>
        <path d="M3 8.2 H9.6 L11.6 12 L9.6 15.8 H3 L5.2 12 Z" fill={ink} />
        <path d="M21 8.2 H14.4 L12.4 12 L14.4 15.8 H21 L18.8 12 Z" fill={ink} />
      </g>
      <rect
        x="10.7"
        y="9.8"
        width="2.6"
        height="4.4"
        rx="0.5"
        fill={knot}
        style={{ transform: `scale(${knotScale})`, transformOrigin: '12px 12px' }}
      />
    </svg>
  );
};
