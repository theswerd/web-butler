import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import {
  resolvePickedElement,
  type PickedElement,
} from '../../lib/page-elements';

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${alpha})`;
}

type ElementHighlightProps = {
  element: PickedElement;
  accentColor: string;
  /** True while the element's chip is hovered — pulses instead of resting. */
  emphasis?: boolean;
};

/**
 * Persistent selection marker over a picked page element: a quiet accent
 * border + tint while referenced, swelling into a pulsing glow when its
 * context chip is hovered.
 *
 * Positioning bypasses React entirely: an rAF loop measures the target and
 * writes a transform straight to the node each frame, so the box tracks
 * scrolling/layout at frame rate instead of trailing a render behind
 * (scroll-listener + setState visibly lagged the page).
 */
export function ElementHighlight({
  element,
  accentColor,
  emphasis = false,
}: ElementHighlightProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let el: Element | null = null;
    let raf = 0;

    const tick = () => {
      // Re-resolve when the node detaches; the fingerprinted resolver refuses
      // impostors that re-matched the positional selector after a re-render.
      if (!el || !el.isConnected) {
        el = resolvePickedElement(element);
      }

      const box = boxRef.current;
      if (box) {
        if (el) {
          const rect = el.getBoundingClientRect();
          box.style.visibility = 'visible';
          box.style.transform = `translate(${rect.left - 2}px, ${rect.top - 2}px)`;
          box.style.width = `${rect.width + 4}px`;
          box.style.height = `${rect.height + 4}px`;
        } else {
          box.style.visibility = 'hidden';
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [element]);

  return (
    <motion.div
      ref={boxRef}
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        backgroundColor: emphasis
          ? withAlpha(accentColor, 0.14)
          : withAlpha(accentColor, 0.07),
        boxShadow: emphasis
          ? [
              `0 0 0 3px ${withAlpha(accentColor, 0.15)}, 0 0 16px 2px ${withAlpha(accentColor, 0.25)}`,
              `0 0 0 5px ${withAlpha(accentColor, 0.22)}, 0 0 28px 6px ${withAlpha(accentColor, 0.4)}`,
            ]
          : `0 0 0 0 ${withAlpha(accentColor, 0)}`,
      }}
      exit={{ opacity: 0 }}
      transition={{
        opacity: { duration: 0.12 },
        backgroundColor: { duration: 0.15 },
        boxShadow: emphasis
          ? {
              duration: 0.9,
              repeat: Infinity,
              repeatType: 'reverse',
              ease: 'easeInOut',
            }
          : { duration: 0.15 },
      }}
      style={{
        top: 0,
        left: 0,
        visibility: 'hidden',
        borderColor: accentColor,
      }}
      className="webbutler:pointer-events-none webbutler:fixed webbutler:rounded-[4px] webbutler:border"
    />
  );
}
