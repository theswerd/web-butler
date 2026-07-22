import type { TargetAndTransition, Transition, Variants } from 'motion/react';

/**
 * Shared animation vocabulary for the Web Butler shell.
 * Every surface animates through these presets so timing/feel stays
 * consistent as new views are added.
 */

/** Snappy spring for UI chrome (popovers, docks, pills). */
export const SPRING_UI: Transition = {
  type: 'spring',
  stiffness: 560,
  damping: 38,
  mass: 0.7,
};

/** Softer spring for larger surfaces (sheets). */
export const SPRING_SHEET: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.9,
};

/** Fast fade for cross-fading content within a fixed frame. */
export const FADE_FAST: Transition = { duration: 0.12, ease: 'easeOut' };

/**
 * Popover growing out of the bottom-left anchor (the + button).
 * Used by the overflow menu and view sheets.
 */
export const popoverVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 6,
    transition: FADE_FAST,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: SPRING_UI,
  },
};

/**
 * Cross-fade between popover bodies (menu <-> sheet). Bodies are absolutely
 * bottom-anchored so size differences never shift layout — keep movement
 * minimal here.
 */
export const popoverBodyVariants: Variants = {
  enter: {
    opacity: 0,
    scale: 0.985,
  },
  center: {
    opacity: 1,
    scale: 1,
    transition: SPRING_UI,
  },
  exit: {
    opacity: 0,
    scale: 0.985,
    transition: FADE_FAST,
  },
};

/** Whole-shell swap: collapsed pill <-> open dock (bottom-right origin). */
export const shellVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
    transition: FADE_FAST,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: SPRING_UI,
  },
};

/** Send button: quick hop (up then settle) fired on submit. */
export const sendHopKeyframes: TargetAndTransition = {
  y: [0, -2.5, 0],
  transition: {
    duration: 0.28,
    times: [0, 0.4, 1],
    ease: ['easeOut', 'easeIn'],
  },
};
