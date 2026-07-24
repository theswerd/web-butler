import { useRef, type KeyboardEvent } from "react";

/**
 * The keyboard model shared by the row-based menu pages (Providers,
 * Settings): focus roves between WHOLE ROWS rather than the controls
 * inside them.
 *
 * - ArrowUp / ArrowDown  move between rows (wrapping)
 * - ArrowLeft            back out to the sidebar
 * - Space                activates every row
 * - ArrowRight / Enter   also activate — unless the row opts out with
 *                        `spaceOnly` (cycling rows like Theme, where
 *                        Enter shouldn't churn the value)
 *
 * Rows render with `ref={rowRefs(i)}`, `tabIndex={-1}` and
 * `onKeyDown={rowKeyDown(i, activate)}`; text inputs inside a row keep
 * their keys (caret movement, typing) untouched.
 */
export function useRovingRows(count: number, onExitLeft?: () => void) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);

  const rowRefs = (index: number) => (el: HTMLDivElement | null) => {
    refs.current[index] = el;
  };

  const focusRow = (index: number) => {
    const next = ((index % count) + count) % count;
    refs.current[next]?.focus();
  };

  const rowKeyDown =
    (index: number, activate: () => void, options?: { spaceOnly?: boolean }) =>
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      // Text inputs own their keys (caret movement, typing).
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(index + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusRow(index - 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          onExitLeft?.();
          break;
        case "ArrowRight":
        case "Enter":
          if (options?.spaceOnly) break;
          event.preventDefault();
          activate();
          break;
        case " ":
          event.preventDefault();
          activate();
          break;
        default:
          break;
      }
    };

  return { rowRefs, focusRow, rowKeyDown };
}
