import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';

type PromptInputContextValue = {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInput() {
  const ctx = useContext(PromptInputContext);
  if (!ctx) {
    throw new Error('PromptInput components must be used within <PromptInput>');
  }
  return ctx;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export type PromptInputProps = {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** External handle to the underlying textarea (for programmatic focus). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
} & Omit<ComponentProps<'div'>, 'children' | 'onSubmit'>;

export function PromptInput({
  className,
  isLoading = false,
  maxHeight = 160,
  value,
  onValueChange,
  onSubmit,
  children,
  disabled = false,
  onClick,
  textareaRef: externalTextareaRef,
  ...props
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? '');
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef ?? internalTextareaRef;

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!disabled) textareaRef.current?.focus();
    onClick?.(event);
  };

  return (
    <PromptInputContext.Provider
      value={{
        isLoading,
        value: value ?? internalValue,
        setValue,
        maxHeight,
        onSubmit,
        disabled,
        textareaRef,
      }}
    >
      <div
        role="group"
        onClick={handleClick}
        className={cx(
          'webbutler:flex webbutler:w-full webbutler:cursor-text webbutler:items-center webbutler:gap-2',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </PromptInputContext.Provider>
  );
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean;
} & ComponentProps<'textarea'>;

export function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  ...props
}: PromptInputTextareaProps) {
  const { value, setValue, maxHeight, onSubmit, disabled, textareaRef } =
    usePromptInput();

  const adjustHeight = (el: HTMLTextAreaElement | null) => {
    if (!el || disableAutosize) return;
    el.style.height = 'auto';
    if (typeof maxHeight === 'number') {
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    } else {
      el.style.height = `min(${el.scrollHeight}px, ${maxHeight})`;
    }
  };

  useLayoutEffect(() => {
    adjustHeight(textareaRef.current);
  }, [value, maxHeight, disableAutosize, textareaRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!disabled) onSubmit?.();
    }
    onKeyDown?.(event);
  };

  return (
    <textarea
      ref={(el) => {
        textareaRef.current = el;
        adjustHeight(el);
      }}
      rows={1}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        adjustHeight(event.target);
        setValue(event.target.value);
      }}
      onKeyDown={handleKeyDown}
      className={cx(
        'webbutler:min-h-0 webbutler:w-full webbutler:flex-1 webbutler:resize-none webbutler:bg-transparent webbutler:py-1 webbutler:text-[13px] webbutler:leading-[18px] webbutler:text-[var(--wc-ink)] webbutler:outline-none webbutler:placeholder:text-[var(--wc-text-4)]',
        className,
      )}
      {...props}
    />
  );
}

export type PromptInputActionsProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputActions({
  children,
  className,
  ...props
}: PromptInputActionsProps) {
  return (
    <div
      className={cx(
        'webbutler:flex webbutler:items-center webbutler:justify-between webbutler:gap-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type PromptInputActionProps = {
  tooltip?: string;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

/** Lightweight action wrapper — tooltip via native title for now. */
export function PromptInputAction({
  tooltip,
  children,
  className,
  ...props
}: PromptInputActionProps) {
  return (
    <div
      title={tooltip}
      className={cx('webbutler:inline-flex', className)}
      onClick={(event) => event.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}
