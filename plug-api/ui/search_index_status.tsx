import type { IndexReport } from "../types/search_admin.ts";
import { Progress } from "./progress.tsx";
import {
  indexProgress,
  indexStateText,
  indexTitle,
} from "./search_admin_format.ts";

/** An index's state line and, while it changes, its progress. */
export function IndexStateLine({ report }: { report: IndexReport }) {
  const progress = indexProgress(report);
  return (
    <>
      <span class="sb-search-index-state">{indexStateText(report)}</span>
      {progress !== null && <Progress value={progress} />}
    </>
  );
}

export type SearchIndexStatusProps = { indexes: IndexReport[] };

/** One row per search index of a space: its title, state and progress. */
export function SearchIndexStatus({ indexes }: SearchIndexStatusProps) {
  return (
    <div class="sb-search-index" role="status">
      {indexes.length === 0 ? (
        <p class="sb-search-index-empty">This space has no search index.</p>
      ) : (
        indexes.map((r) => (
          <div class="sb-search-index-row" key={r.kind} data-kind={r.kind}>
            <span class="sb-search-index-title">{indexTitle(r.kind)}</span>
            <IndexStateLine report={r} />
          </div>
        ))
      )}
    </div>
  );
}
