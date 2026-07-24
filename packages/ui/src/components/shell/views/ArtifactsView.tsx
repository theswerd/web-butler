import { HiOutlineDocumentText, HiOutlineTrash } from "react-icons/hi2";
import type { Report } from "../../../lib/shell";
import { ListRow, RowIconButton, RowTime, timeAgo } from "./ListRow";
import {
  HeaderAction,
  HeaderSearch,
  ListNote,
  useListSearch,
  ViewBody,
  ViewEmpty,
  ViewFrame,
} from "./ViewHeader";

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
  const { query, setQuery, shown } = useListSearch(artifacts, (artifact) =>
    [artifact.title, artifact.description, artifact.text].join("\n"),
  );

  if (artifacts.length === 0) {
    return (
      <ViewFrame label="Artifacts">
        <ViewEmpty icon={HiOutlineDocumentText}>
          No artifacts yet. Reports, drafts, and other long-form results
          collect here.
        </ViewEmpty>
      </ViewFrame>
    );
  }

  return (
    <ViewFrame
      label="Artifacts"
      actions={
        <>
          <HeaderSearch value={query} onChange={setQuery} />
          {onClear ? (
            <HeaderAction onClick={onClear}>Clear all</HeaderAction>
          ) : null}
        </>
      }
    >
      <ViewBody>
        {shown.length === 0 ? (
          <ListNote>Nothing matches "{query.trim()}".</ListNote>
        ) : null}
        {shown.map((artifact) => (
          <ListRow
            key={artifact.id}
            onOpen={onOpen && (() => onOpen(artifact))}
            openTitle="Open in side panel"
            leading={
              <HiOutlineDocumentText
                size={13}
                aria-hidden
                className="webbutler:mt-px webbutler:shrink-0 webbutler:text-[var(--wc-text-4)]"
              />
            }
            title={artifact.title}
            secondary={artifact.description}
            meta={artifact.meta || null}
          >
            {onRemove ? (
              <RowIconButton
                title="Remove"
                ariaLabel={`Remove: ${artifact.title}`}
                onClick={() => onRemove(artifact)}
                hoverReveal
              >
                <HiOutlineTrash size={11} aria-hidden />
              </RowIconButton>
            ) : null}
            <RowTime>{timeAgo(artifact.createdAt)}</RowTime>
          </ListRow>
        ))}
      </ViewBody>
    </ViewFrame>
  );
}
