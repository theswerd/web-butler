/**
 * The whole cut rides the music: Chronos runs at 120 BPM, so one beat
 * is exactly 15 frames at 30fps. Every scene boundary, word slam, and
 * SFX lands on this grid.
 */
export const BPM = 120;
export const FPS = 30;

export const beat = (k: number): number => Math.round((k * (60 / BPM)) * FPS);

/** Scene boundaries, in beats. */
export const GRID = {
  intro: 0,
  headline: 4,
  features: [10, 22, 34, 46],
  outro: 58,
  end: 72,
};

export const TOTAL_FRAMES = beat(GRID.end);
