import type { ReactNode } from 'react';

/**
 * Deliberately tiny renderer for model prose: paragraphs, "- " lists,
 * ``` fences, and inline `code` / **bold**. Shared by the in-page answer
 * card and the side-panel report view; a real markdown renderer can slot
 * in behind the same `text` prop later.
 */
export function MarkdownLite({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className="webbutler:flex webbutler:flex-col webbutler:gap-2 webbutler:text-[12px] webbutler:leading-[1.55] webbutler:text-[var(--wc-text-2)]">
      {blocks.map((block, i) => {
        if (block.kind === 'code') {
          return (
            <pre
              key={i}
              className="webbutler:overflow-x-auto webbutler:rounded-md webbutler:border webbutler:border-[var(--wc-border-hairline)] webbutler:bg-[var(--wc-hover-1)] webbutler:px-2.5 webbutler:py-2 webbutler:font-mono webbutler:text-[11px] webbutler:leading-[1.5] webbutler:text-[var(--wc-ink)]"
            >
              {block.text}
            </pre>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={i} className="webbutler:flex webbutler:flex-col webbutler:gap-1">
              {block.items.map((item, j) => (
                <li key={j} className="webbutler:flex webbutler:gap-2">
                  <span
                    aria-hidden
                    className="webbutler:mt-[7px] webbutler:size-[3px] webbutler:shrink-0 webbutler:rounded-full webbutler:bg-[var(--wc-text-4)]"
                  />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string };

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // Fenced code first so its blank lines don't split into paragraphs.
  const parts = text.split(/```(?:\w*\n)?/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      blocks.push({ kind: 'code', text: part.replace(/\n$/, '') });
      return;
    }
    for (const chunk of part.split(/\n{2,}/)) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const lines = trimmed.split('\n');
      if (lines.every((line) => line.trimStart().startsWith('- '))) {
        blocks.push({
          kind: 'list',
          items: lines.map((line) => line.trimStart().slice(2)),
        });
      } else {
        blocks.push({ kind: 'paragraph', text: trimmed });
      }
    }
  });
  return blocks;
}

/** Inline `code` and **bold** only. */
export function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((piece, i) => {
    if (piece.startsWith('`') && piece.endsWith('`')) {
      return (
        <code
          key={i}
          className="webbutler:rounded webbutler:bg-[var(--wc-hover-2)] webbutler:px-1 webbutler:py-px webbutler:font-mono webbutler:text-[11px] webbutler:text-[var(--wc-ink)]"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }
    if (piece.startsWith('**') && piece.endsWith('**')) {
      return (
        <strong key={i} className="webbutler:font-semibold webbutler:text-[var(--wc-ink)]">
          {piece.slice(2, -2)}
        </strong>
      );
    }
    return piece;
  });
}
