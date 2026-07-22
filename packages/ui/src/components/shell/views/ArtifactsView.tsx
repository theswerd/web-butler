import { HiOutlineDocumentText } from "react-icons/hi2";
import type { Report } from "../../../lib/shell";
import { timeAgo } from "./TasksView";
import { ViewHeader } from "./ViewHeader";

type ArtifactsViewProps = {
  artifacts: Report[];
  /** Row clicked — the shell opens this artifact in the side panel. */
  onOpen?: (artifact: Report) => void;
};

/**
 * Every artifact of the session, newest first — the durable counterpart to
 * Notifications. A notice tells you a job finished; this is where its
 * output lives afterwards. Global state, identical in every tab. Clicking
 * a row opens the artifact in the Chrome side panel.
 */
export function ArtifactsView({ artifacts, onOpen }: ArtifactsViewProps) {
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

  return (
    <div className="webbutler:flex webbutler:h-full webbutler:flex-col">
      <ViewHeader label="Artifacts" />
      <div className="webbutler:min-h-0 webbutler:flex-1 webbutler:overflow-y-auto webbutler:pb-1.5 webbutler:pt-0.5">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => onOpen?.(artifact)}
            className="webbutler:flex webbutler:w-full webbutler:cursor-pointer webbutler:items-start webbutler:gap-2 webbutler:px-3 webbutler:py-1.5 webbutler:text-left webbutler:transition-colors webbutler:duration-100 webbutler:hover:bg-[var(--wc-hover-1)]"
          >
            <span className="webbutler:min-w-0 webbutler:flex-1">
              <span className="webbutler:block webbutler:truncate webbutler:text-[12px] webbutler:font-medium webbutler:text-[var(--wc-ink)]">
                {artifact.title}
              </span>
              <span className="webbutler:block webbutler:truncate webbutler:text-[10px] webbutler:text-[var(--wc-text-3)]">
                {artifact.description}
              </span>
            </span>
            <span className="webbutler:shrink-0 webbutler:pt-px webbutler:text-[10px] webbutler:text-[var(--wc-text-4)]">
              {timeAgo(artifact.createdAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
