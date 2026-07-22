import { viewTransitionName } from './identity';

type TransitionUpdate = () => void | Promise<void>;

function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

/**
 * Run a DOM/React update inside a View Transition when available.
 * Falls back to an immediate update on unsupported browsers.
 */
export async function withViewTransition(
  update: TransitionUpdate,
): Promise<void> {
  if (!supportsViewTransitions()) {
    await update();
    return;
  }

  const transition = document.startViewTransition(async () => {
    await update();
  });

  try {
    await transition.finished;
  } catch {
    // Interrupted transitions reject; treat as non-fatal.
  }
}

/**
 * Apply a stable view-transition-name so morphing can continue after remount.
 * Prefer pairing this with Motion layoutId using the same logical key.
 */
export function applyViewTransitionName(
  element: HTMLElement | null,
  key: string | null,
): void {
  if (!element) return;

  if (!key) {
    element.style.removeProperty('view-transition-name');
    return;
  }

  element.style.setProperty('view-transition-name', viewTransitionName(key));
}
