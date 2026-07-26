import { Easing, interpolate, useCurrentFrame } from 'remotion';

const SLAM = Easing.bezier(0.2, 1.4, 0.4, 1);

/** A word (or phrase) that slams into place: scale punch, blur settle. */
export const Slam: React.FC<{
  at: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, children, style }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  const p = interpolate(t, [0, 9], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: SLAM,
  });
  return (
    <span
      style={{
        display: 'inline-block',
        opacity: t < 0 ? 0 : interpolate(t, [0, 4], [0, 1], {
          extrapolateRight: 'clamp',
        }),
        scale: String(1.35 - 0.35 * p),
        filter: `blur(${(1 - p) * 8}px)`,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** A chip that whips in with rotation overshoot. */
export const Whip: React.FC<{
  at: number;
  tilt?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at, tilt = 8, children, style }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  const p = interpolate(t, [0, 11], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.25, 1.5, 0.45, 1),
  });
  return (
    <span
      style={{
        display: 'inline-flex',
        opacity: t < 0 ? 0 : 1,
        scale: String(p),
        rotate: `${(1 - p) * tilt}deg`,
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** Hard-cut spice: a white flash that decays over a few frames. */
export const Flash: React.FC<{ at: number; color?: string }> = ({
  at,
  color = '#ffffff',
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > 5) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: color,
        opacity: interpolate(t, [0, 5], [0.85, 0]),
        pointerEvents: 'none',
        zIndex: 40,
      }}
    />
  );
};
