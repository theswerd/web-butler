import { motion, type Variants } from 'motion/react';

/**
 * Tux Bow — the Web Butler mark. Angular formalwear silhouette: two
 * hexagonal wings in ink with a knot in mist. The inner group animates
 * through the `adjust` variant (a quick "straighten the bowtie" wiggle),
 * which is propagated from a hovered motion parent.
 */

/** Ink for the wings (follows text); inactive knots stay neutral. */
const INK = 'currentColor';
const MIST = 'var(--wc-knot, #a3a3a3)';

/** Fired on parent hover — pause, tilt, over-correct, settle. */
export const bowtieAdjustVariants: Variants = {
  rest: { rotate: 0 },
  adjust: {
    rotate: [0, -8, 5, -2, 0],
    transition: {
      duration: 0.5,
      times: [0, 0.25, 0.55, 0.8, 1],
      ease: 'easeInOut',
    },
  },
};

/**
 * The `working` loop: the bow is pulled apart, then the wing pair orbits
 * 180° around the knot (each wing swings over/under the tie to the other
 * side) and tucks back in. The mark has 180° rotational symmetry, so the
 * landing reads as the true bow; the second half repeats the move on to
 * 360° and the loop closes with no rotation jump.
 *
 * One shared timeline: the orbit lives on a group wrapping both wings
 * (origin = the knot), the pull-apart on each wing (left goes -x).
 *
 * Unhurried on purpose: per half, ~0.35s pull, ~0.8s orbit, ~0.35s tuck,
 * then a full ~0.5s rest on the assembled bow before it goes again.
 */
const WORK_TIMES = [0, 0.09, 0.29, 0.375, 0.5, 0.59, 0.79, 0.875, 1];
const WORK_X = [0, 2.75, 2.75, 0, 0, 2.75, 2.75, 0, 0];
const WORK_ORBIT = [0, 0, 180, 180, 180, 180, 360, 360, 360];
/** Pull/tuck: pop out fast and overshoot a touch before settling. */
const WORK_POP: [number, number, number, number] = [0.34, 1.4, 0.64, 1];
/** Orbit: wind up (a small backwards dip), whip around, overshoot, settle —
    the spin spends its speed in the middle instead of pacing evenly. */
const WORK_SWING: [number, number, number, number] = [0.55, -0.15, 0.35, 1.25];
/** Per-segment easing (8 segments between the 9 keyframes, per half:
    pull · orbit · tuck · rest). Shared by x and rotate: each ease only
    bites on the property that actually moves in that segment; the other
    holds a constant value, where easing is a no-op. */
const WORK_EASE = [
  WORK_POP,
  WORK_SWING,
  WORK_POP,
  'linear',
  WORK_POP,
  WORK_SWING,
  WORK_POP,
  'linear',
] as const;
const WORK_TRANSITION = {
  duration: 4,
  times: WORK_TIMES,
  ease: [...WORK_EASE],
  repeat: Infinity,
};

type BowtieMarkProps = {
  size?: number;
  ink?: string;
  knot?: string;
  /** Loop the pulled-apart/flip animation while the butler is busy. */
  working?: boolean;
};

export function BowtieMark({
  size = 16,
  ink = INK,
  knot = MIST,
  working = false,
}: BowtieMarkProps) {
  // Explicit `animate` (rather than variants) so the busy motion runs on
  // its own, independent of the hover "adjust" wiggle on the parent group.
  const wing = (side: -1 | 1) =>
    working ? { x: WORK_X.map((value) => value * side) } : { x: 0 };
  const workTransition = working
    ? WORK_TRANSITION
    : { duration: 0.25, ease: 'easeOut' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <motion.g
        variants={bowtieAdjustVariants}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        {/* Orbit group: both wings ride it around the knot. Its fill-box
            stays centered on the knot even while the wings are pulled out
            (the pull is symmetric), so `center` is the knot. */}
        <motion.g
          animate={working ? { rotate: WORK_ORBIT } : { rotate: 0 }}
          transition={workTransition}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <motion.path
            d="M3 8.2 H9.6 L11.6 12 L9.6 15.8 H3 L5.2 12 Z"
            fill={ink}
            animate={wing(-1)}
            transition={workTransition}
          />
          <motion.path
            d="M21 8.2 H14.4 L12.4 12 L14.4 15.8 H21 L18.8 12 Z"
            fill={ink}
            animate={wing(1)}
            transition={workTransition}
          />
        </motion.g>
        {/* style, not the fill attribute — var() only resolves via CSS. */}
        <rect
          x="10.7"
          y="9.8"
          width="2.6"
          height="4.4"
          rx="0.5"
          style={{ fill: knot, transition: 'fill 150ms ease-out' }}
        />
      </motion.g>
    </svg>
  );
}
