import {
  type HTMLMotionProps,
  motion,
  type Transition,
} from 'motion/react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import { dataIdentityAttr, viewTransitionName } from '../lib/identity';
import { applyViewTransitionName } from '../lib/view-transitions';

const DEFAULT_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 36,
  mass: 0.8,
};

type SharedElementProps = HTMLMotionProps<'div'> & {
  /** Stable logical key shared across remounts / moves. */
  id: string;
  children?: ReactNode;
  /** When false, skips Motion layout animations but keeps VT identity. */
  layout?: boolean;
};

/**
 * Keeps Motion layoutId and CSS view-transition-name aligned on one key so
 * shared-element continuity works for in-app moves and page remounts.
 */
export const SharedElement = forwardRef<HTMLDivElement, SharedElementProps>(
  function SharedElement(
    { id, layout = true, style, children, transition, ...rest },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(forwardedRef, () => localRef.current as HTMLDivElement);

    useEffect(() => {
      applyViewTransitionName(localRef.current, id);
      return () => applyViewTransitionName(localRef.current, null);
    }, [id]);

    return (
      <motion.div
        ref={localRef}
        layout={layout}
        layoutId={id}
        transition={transition ?? DEFAULT_TRANSITION}
        style={{
          viewTransitionName: viewTransitionName(id),
          ...style,
        }}
        {...dataIdentityAttr(id)}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
