import { useState } from "react";
import { HiOutlineDocumentText, HiOutlineTrash } from "react-icons/hi2";
import type { Report } from "../../../lib/shell";
import { timeAgo } from "./TasksView";
import { HeaderSearch, ViewHeader } from "./ViewHeader";

type ArtifactsViewProps = {
  artifacts: Report[];
  /** Row clicked — the shell opens this artifact in the side panel. */
  onOpen?: (artifact: Report) => void;
  /** Trash one artifact (cache + server row). */
  onRemove?: (artifact: Report) => void;
  /** Trash every artifact. */
  onClear?: () => void;
};

/**
 * Every artifact of the session, newest first — the durable counterpart to
 * the task list. A task row tells you a job finished; this is where its
 * output lives afterwards. Global state, identical in every tab. Clicking
 * a row opens the artifact in the Chrome side panel; search filters by
 * title, description, and body text.
 */
export function ArtifactsView({
  artifacts,
  onOpen,
  onRemove,
  onClear,
}: ArtifactsViewProps) {
  const [query, setQuery] = useState("");

  if (artifacts.length === 0) {
    return (
      <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
        <ViewHeader label="Artifacts" />
        <div className="webbutler:flex webbutler:flex-1 webbutler:flex-col webbutler:items-center webbutler:justify-center webbutler:gap-1.5 webbutler:px-4 webbutler:text-center">
          <HiOutlineDocumentText
            size={16}
            aria-hidden
            className="webbutler:text-[var(--wc-text-4)]"
          />
          <p className="webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
            No artifacts yet. Reports, drafts, and other long-form results
            collect here.
          </p>
        </div>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? artifacts.filter((artifact) =>
        [artifact.title, artifact.description, artifact.text]
          .join("\n")
          .toLowerCase()
          .includes(needle),
      )
    : artifacts;

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
      <ViewHeader label="Artifacts">
        <HeaderSearch value={query} onChange={setQuery} />
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="webbutler:cursor-pointer webbutler:rounded-full webbutler:px-1.5 webbutler:py-0.5 webbutler:text-[10px] webbutler:text-[var(--wc-text-3)] webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)]"
          >
            Clear all
          </button>
        ) : null}
      </ViewHeader>
      <div className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:pb-1.5 webbutler:pt-0.5">
        {shown.length === 0 ? (
          <p className="webbutler:px-3 webbutler:py-4 webbutler:text-center webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
            Nothing matches "{query.trim()}".
          </p>
        ) : null}
        {shown.map((artifact) => (
          // Container div, not a button: the trash control nests inside and
          // buttons can't nest. The main area is its own button.
          <div
            key={artifact.id}
            className="webbutler:group webbutler:flex webbutler:w-full webbutler:items-start webbutler:gap-2 webbutler:px-3 webbutler:py-2 webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
          >
            <button
              type="button"
              title="Open in side panel"
              onClick={() => onOpen?.(artifact)}
              className="webbutler:flex webbutler:min-w-0 webbutler:flex-1 webbutler:cursor-pointer webbutler:items-start webbutler:gap-2 webbutler:text-left"
            >
              <HiOutlineDocumentText
                size={13}
                aria-hidden
                className="webbutler:mt-px webbutler:shrink-0 webbutler:text-[var(--wc-text-4)]"
              />
              <span className="webbutler:min-w-0 webbutler:flex-1">
                <span className="webbutler:block webbutler:truncate webbutler:text-[12px] webbutler:leading-4 webbutler:font-medium webbutler:text-[var(--wc-ink)]">
                  {artifact.title}
                </span>
                <span className="webbutler:block webbutler:truncate webbutler:pt-px webbutler:text-[11px] webbutler:text-[var(--wc-text-3)]">
                  {artifact.description}
                </span>
                {artifact.meta ? (
                  <span className="webbutler:block webbutler:truncate webbutler:pt-px webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
                    {artifact.meta}
                  </span>
                ) : null}
              </span>
            </button>
            {onRemove ? (
              // Hover-revealed, slot always reserved so timestamps line up.
              <button
                type="button"
                title="Remove"
                aria-label={`Remove: ${artifact.title}`}
                onClick={() => onRemove(artifact)}
                className="webbutler:flex webbutler:size-5 webbutler:shrink-0 webbutler:cursor-pointer webbutler:items-center webbutler:justify-center webbutler:rounded-full webbutler:text-[var(--wc-text-4)] webbutler:opacity-0 webbutler:transition-all webbutler:duration-100 webbutler:group-hover:opacity-100 webbutler:hover:bg-[var(--wc-hover-2)] webbutler:hover:text-[var(--wc-ink)] webbutler:focus-visible:opacity-100"
              >
                <HiOutlineTrash size={11} aria-hidden />
              </button>
            ) : null}
            <span className="webbutler:shrink-0 webbutler:pt-[3px] webbutler:text-[10px] webbutler:tabular-nums webbutler:text-[var(--wc-text-4)]">
              {timeAgo(artifact.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
