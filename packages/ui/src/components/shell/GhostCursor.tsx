import { AnimatePresence, motion } from "motion/react";

/**
 * The visible pointer the butler "moves" while it drives the page. It is
 * purely cosmetic: the background animates it to a target with a move
 * command, then fires the real debugger click at the same spot a beat
 * later, so the user sees a hand doing the work rather than the DOM
 * mutating on its own. Coordinates are viewport CSS pixels (from CDP),
 * which line up with this fixed layer.
 */
export type GhostCursorState = {
  x: number;
  y: number;
  visible: boolean;
  /** Short hint of what it's about to touch, shown by the tip. */
  label?: string;
  /** Bumps on every press/type so the click ripple re-fires. */
  pressCount: number;
};

export const INITIAL_GHOST_CURSOR: GhostCursorState = {
  x: 0,
  y: 0,
  visible: false,
  pressCount: 0,
};

export function GhostCursor({
  state,
  accentColor,
}: {
  state: GhostCursorState;
  accentColor: string;
}) {
  return (
    <AnimatePresence>
      {state.visible ? (
        <motion.div
          key="ghost-cursor"
          aria-hidden
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, x: state.x, y: state.y }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{
            // The glide reads as intent; keep it in step with the
            // background's MOVE_MS. Opacity/scale settle faster.
            x: { type: "tween", duration: 0.48, ease: [0.22, 1, 0.36, 1] },
            y: { type: "tween", duration: 0.48, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.15 },
            scale: { duration: 0.15 },
          }}
          style={{ left: 0, top: 0 }}
          className="webbutler:pointer-events-none webbutler:fixed webbutler:z-[2147483647]"
        >
          {/* Click ripple — remounts on every press so it replays. */}
          <AnimatePresence>
            <motion.span
              key={state.pressCount}
              initial={{ opacity: 0.5, scale: 0 }}
              animate={{ opacity: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                left: 0,
                top: 0,
                width: 34,
                height: 34,
                marginLeft: -17,
                marginTop: -17,
                border: `2px solid ${accentColor}`,
              }}
              className="webbutler:absolute webbutler:rounded-full"
            />
          </AnimatePresence>

          {/* The pointer. Tip sits at the layer origin (the target point). */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}
          >
            <path
              d="M5 2.5 L5 19 L9.2 15 L12 21 L14.6 19.9 L11.8 14 L18 14 Z"
              fill={accentColor}
              stroke="white"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>

          {state.label ? (
            <span
              style={{ backgroundColor: accentColor }}
              className="webbutler:absolute webbutler:left-5 webbutler:top-5 webbutler:max-w-[180px] webbutler:truncate webbutler:rounded-full webbutler:px-2 webbutler:py-0.5 webbutler:text-[10px] webbutler:font-medium webbutler:text-white webbutler:shadow-sm"
            >
              {state.label}
            </span>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
