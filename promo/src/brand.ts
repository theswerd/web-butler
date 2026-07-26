import { loadFont as loadSerif } from '@remotion/google-fonts/IBMPlexSerif';
import { loadFont as loadSans } from '@remotion/google-fonts/IBMPlexSans';
import { loadFont as loadMono } from '@remotion/google-fonts/IBMPlexMono';

const serif = loadSerif();
const sans = loadSans();
const mono = loadMono();

/** The homepage's palette, verbatim. */
export const INK = '#171717';
export const INK_2 = '#525252';
export const INK_3 = '#a3a3a3';
export const LINE = '#e5e5e5';
export const PAPER = '#ffffff';
export const ACCENT = '#3b82f6';
export const CLAUDE = '#D97757';

export const SERIF = `${serif.fontFamily}, Georgia, serif`;
export const SANS = `${sans.fontFamily}, -apple-system, sans-serif`;
export const MONO = `${mono.fontFamily}, ui-monospace, monospace`;
