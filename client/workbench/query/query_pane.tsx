import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { Client } from "../../client.ts";
import type { ConsoleSession } from "../console/console_session.ts";
import { narrowingTags, type TagListEntry } from "../data/tag_list.ts";
import { QueryBar } from "./query_bar.tsx";
import type { QueryBuilder } from "./query_builder.ts";
import {
  GroupByRow,
  LimitRow,
  OrderByRow,
  WhereRow,
} from "./query_clauses.tsx";
import { canNarrow, type PageScope, type QuerySource } from "./query_from.ts";
import { QueryPreview } from "./query_preview.tsx";
import { SelectRow } from "./query_select.tsx";
import { listRelationKinds, narrowSource } from "./query_source.ts";

/**
 * The Data tab's Objects view: the picked tag's objects, shaped by the query
 * editor beside them (one row per clause; it can be closed). The generated
 * text stays in the bar at the bottom.
 */
export function QueryPane({
  client,
  session,
  builder,
  entries,
  label,
  onOpenTag,
  clausesHandle,
}: {
  client: Client;
  session: ConsoleSession;
  builder: QueryBuilder;
  /** The Data tab's tag list, which says what the source narrows to */
  entries: TagListEntry[];
  /** How the picked tag is shown in the From row */
  label: string;
  /** Opens a tag the source is narrowed to */
  onOpenTag?: (tag: string) => void;
  /** Drags the edge between the query editor and the results */
  clausesHandle?: ComponentChildren;
}) {
  const m = builder.model;
  const [kinds, setKinds] = useState<string[]>([]);
  const relationPicked =
    m?.source.root === "relation" && m.source.by === "root";
  useEffect(() => {
    if (relationPicked) void listRelationKinds(client).then(setKinds);
  }, [client, relationPicked]);
  const narrow = (s: QuerySource) => void narrowSource(client, builder, s);
  const dataRoot =
    m?.source.root === "data" &&
    m.source.by === "root" &&
    entries.some((e) => e.data && e.name === m.source.tag);
  return (
    <div className={`sb-wbq-main${builder.editing ? "" : " sb-wbq-browse"}`}>
      {builder.editing ? clausesHandle : null}
      {/* A replaced model (new tag, Undo) starts the inputs over */}
      <div className="sb-wbq-clauses" key={builder.resets}>
        {m ? (
          <>
            <span className="sb-wbq-label">From</span>
            <div className="sb-wbq-row">
              <span className="sb-wbq-chip">{label}</span>
              <PageScopeControl source={m.source} onNarrow={narrow} />
              <NarrowSelect
                source={m.source}
                dataRoot={dataRoot}
                entries={entries}
                kinds={kinds}
                onNarrow={narrow}
              />
              {onOpenTag &&
              m.source.by === "root" &&
              m.source.tag !== null &&
              m.source.root !== "relation" &&
              m.source.root !== "data" ? (
                <button
                  type="button"
                  className="sb-wbq-link"
                  onClick={() => onOpenTag(m.source.tag!)}
                >
                  Open #{m.source.tag}
                </button>
              ) : null}
              <span className="sb-wbq-spacer" />
              <button
                type="button"
                className="sb-wbq-x"
                aria-label="Close query editor"
                title="Close query editor"
                onClick={() => builder.setEditing(false)}
              >
                ✕
              </button>
            </div>
            <WhereRow client={client} builder={builder} model={m} />
            <GroupByRow client={client} builder={builder} model={m} />
            <OrderByRow client={client} builder={builder} model={m} />
            <SelectRow client={client} builder={builder} model={m} />
            <LimitRow client={client} builder={builder} model={m} />
          </>
        ) : null}
      </div>
      <QueryPreview client={client} builder={builder} />
      <QueryBar client={client} session={session} builder={builder} />
    </div>
  );
}

const PAGE_SCOPES: {
  scope: PageScope | undefined;
  label: string;
  tooltip: string;
}[] = [
  { scope: undefined, label: "All", tooltip: "Every page" },
  {
    scope: "content",
    label: "Content",
    tooltip: "Pages outside Library/ and CONFIG",
  },
  { scope: "tool", label: "Tool", tooltip: "Pages under Library/ and CONFIG" },
];

/** Narrows pages to content pages or tool pages; absent for other objects */
function PageScopeControl({
  source,
  onNarrow,
}: {
  source: QuerySource;
  onNarrow: (s: QuerySource) => void;
}) {
  if (source.root !== "page") return null;
  return (
    <SegmentedControl
      items={PAGE_SCOPES}
      activeIndex={PAGE_SCOPES.findIndex((p) => p.scope === source.scope)}
      onPick={(i) => {
        const { scope: _, ...rest } = source;
        const scope = PAGE_SCOPES[i].scope;
        onNarrow(scope ? { ...rest, scope } : rest);
      }}
      ariaLabel="Which pages"
    />
  );
}

/**
 * Narrows the picked source: a root tag's objects to those carrying a user
 * tag (a relation kind, for relations), or a user tag's objects to one root
 * tag. Absent when the source can't be narrowed.
 */
function NarrowSelect({
  source,
  dataRoot,
  entries,
  kinds,
  onNarrow,
}: {
  source: QuerySource;
  /** The source is a data block's root tag, narrowed already: index.data takes one tag */
  dataRoot: boolean;
  entries: TagListEntry[];
  kinds: string[];
  onNarrow: (s: QuerySource) => void;
}) {
  if (source.by === "tag" && source.tag !== null) {
    const tag = source.tag;
    const roots = entries.find((e) => e.name === tag)?.roots ?? [];
    if (!roots.length) return null;
    return (
      <label className="sb-wbq-narrow">
        <span>on</span>
        <select
          className="sb-select"
          value={source.root ?? ""}
          onChange={(e) => {
            const root = e.currentTarget.value || null;
            onNarrow({ root, tag, by: "tag" });
          }}
        >
          <option value="">any</option>
          {roots.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const root = source.root;
  if (root === null || !canNarrow(root) || dataRoot) {
    return null;
  }
  const relation = root === "relation";
  const options = relation ? kinds : narrowingTags(entries, root);
  if (!options.length) return null;
  return (
    <label className="sb-wbq-narrow">
      <span>{relation ? "kind" : "tagged"}</span>
      <select
        className="sb-select"
        value={source.tag ?? ""}
        onChange={(e) => {
          const tag = e.currentTarget.value || null;
          onNarrow({ ...source, tag });
        }}
      >
        <option value="">any</option>
        {options.map((t) => (
          <option key={t} value={t}>
            {relation || root === "data" ? t : `#${t}`}
          </option>
        ))}
      </select>
    </label>
  );
}
