import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { SPRING_UI } from '../../lib/motion';
import {
  elementLabel,
  pickElement,
  type PickedElement,
} from '../../lib/page-elements';

type HoverTarget = {
  element: Element;
  rect: DOMRect;
  label: string;
};

type ElementPickerOverlayProps = {
  /** `keepPicking` is true for shift-clicks: the user is collecting
      several elements, so the shell should leave the picker armed. */
  onPick: (picked: PickedElement, keepPicking: boolean) => void;
  onCancel: () => void;
};

/** True for nodes that belong to the extension itself, never pickable. */
function isOurs(el: Element): boolean {
  return el.tagName.toLowerCase() === 'web-butler';
}

/**
 * Full-viewport pick layer. It owns the pointer while active: hovering
 * resolves the page element underneath via elementsFromPoint (the overlay
 * itself is inside our shadow host, which gets filtered out), click captures,
 * Esc cancels. Page gets no clicks while picking.
 */
export function ElementPickerOverlay({ onPick, onCancel }: ElementPickerOverlayProps) {
  const [target, setTarget] = useState<HoverTarget | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    // Capture phase so the shell's own Esc handling never sees it.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  const resolveTarget = (clientX: number, clientY: number): Element | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (isOurs(el)) continue;
      if (el === document.documentElement || el === document.body) return null;
      return el;
    }
    return null;
  };

  const onMouseMove = (event: React.MouseEvent) => {
    const el = resolveTarget(event.clientX, event.clientY);
    if (!el) {
      setTarget(null);
      return;
    }
    if (target?.element === el) return;
    setTarget({
      element: el,
      rect: el.getBoundingClientRect(),
      label: elementLabel(el),
    });
  };

  const onClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const el = resolveTarget(event.clientX, event.clientY);
    if (el) onPick(pickElement(el), event.shiftKey);
    else onCancel();
  };

  const labelOnTop = target != null && target.rect.top > 28;

  return (
    <div
      className="webbutler:pointer-events-auto webbutler:fixed webbutler:inset-0 webbutler:cursor-crosshair"
      onMouseMove={onMouseMove}
      onClick={onClick}
      onMouseLeave={() => setTarget(null)}
    >
      {target ? (
        <motion.div
          initial={false}
          animate={{
            x: target.rect.left - 2,
            y: target.rect.top - 2,
            width: target.rect.width + 4,
            height: target.rect.height + 4,
          }}
          transition={SPRING_UI}
          style={{
            borderColor: 'var(--wc-selection)',
            backgroundColor:
              'color-mix(in srgb, var(--wc-selection) 8%, transparent)',
          }}
          className="webbutler:pointer-events-none webbutler:absolute webbutler:top-0 webbutler:left-0 webbutler:rounded-[4px] webbutler:border"
        >
          <span
            style={{ backgroundColor: 'var(--wc-selection)' }}
            className={`webbutler:absolute webbutler:left-0 webbutler:max-w-full webbutler:truncate webbutler:rounded-full webbutler:px-2 webbutler:py-0.5 webbutler:font-mono webbutler:text-[9px] webbutler:whitespace-nowrap webbutler:text-white ${
              labelOnTop ? 'webbutler:-top-6' : 'webbutler:top-full webbutler:mt-1'
            }`}
          >
            {target.label}
          </span>
        </motion.div>
      ) : null}
    </div>
  );
}
