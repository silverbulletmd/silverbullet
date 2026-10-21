import { Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { Client } from "../../client.ts";
import { LuaRuntimeError } from "../../space_lua/runtime.ts";
import { errorFrames, LuaErrorDetails } from "../shared/lua_error.tsx";
import { RenderedValue } from "../shared/rendered_value.tsx";
import { errorMessage } from "../shared/value_preview.ts";
import { ValueTree } from "../shared/value_tree.tsx";
import type { QueryBuilder } from "./query_builder.ts";
import { isGrouped } from "./query_edits.ts";
import { sourceLabel } from "./query_from.ts";
import {
  firstRows,
  fullCounts,
  LEADING_ROWS,
  leadingCounts,
  type PreviewCounts,
  previewDelay,
  previewSlice,
  resultsHeading,
} from "./query_preview.ts";
import { evalQueryText } from "./query_source.ts";
import { generateQuery } from "./query_text.ts";

type Result =
  | { kind: "pending" }
  | ({ kind: "value"; value: unknown } & PreviewCounts)
  | { kind: "error"; error: unknown };

/** The objects the builder's query finds, the way a page would render them. */
export function QueryPreview({
  client,
  builder,
}: {
  client: Client;
  builder: QueryBuilder;
}) {
  const [view, setView] = useState(0);
  const [result, setResult] = useState<Result>({ kind: "pending" });
  const m = builder.model;
  const limit = m?.limit ?? null;
  const grouped = !!m && isGrouped(m);
  // Run without the limit, for "N of M": the limit only cuts the rows off
  const text = m
    ? generateQuery({ ...m, limit: null }, builder.fields, { wrap: false })
    : null;
  // Unsorted and ungrouped, the first rows don't need every object read
  // (`leadingRowsNeeded`): show them first, then count the rest
  const leadingText =
    m && !grouped && !m.sorts.length
      ? generateQuery({ ...m, limit: LEADING_ROWS }, builder.fields, {
          wrap: false,
        })
      : null;
  // The columns don't change how many there are
  const countText =
    m && leadingText
      ? generateQuery(
          { ...m, limit: null, select: { mode: "table", columns: [] } },
          builder.fields,
          { wrap: false },
        )
      : null;

  const lastRun = useRef(0);
  const shownValue = result.kind === "value" ? result.value : undefined;
  // A fresh slice would render the table again on every re-render of the tab,
  // the count arriving included
  const slice = useMemo(
    () => (shownValue === undefined ? null : previewSlice(shownValue)),
    [shownValue],
  );

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        lastRun.current = Date.now();
        try {
          if (leadingText && countText) {
            const rows = await evalQueryText(client, leadingText);
            if (cancelled) return;
            const value = limit === null ? rows : firstRows(rows, limit);
            const counts = leadingCounts(rows, limit);
            setResult({ kind: "value", value, ...counts });
            if (counts.matched !== null) return;
            const all = await evalQueryText(client, countText);
            if (!cancelled) {
              setResult({ kind: "value", value, ...fullCounts(all, limit) });
            }
            return;
          }
          const all = await evalQueryText(client, text);
          const value = limit === null ? all : firstRows(all, limit);
          if (!cancelled) {
            setResult({ kind: "value", value, ...fullCounts(all, limit) });
          }
        } catch (error) {
          if (!cancelled) setResult({ kind: "error", error });
        }
      },
      previewDelay(Date.now(), lastRun.current),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // A new version of the space's data runs the same query again
  }, [client, text, leadingText, countText, limit, builder.dataVersion]);

  if (!m) return <div className="sb-wbq-preview" />;
  let header = "";
  let body = null;
  if (result.kind === "error") {
    body =
      result.error instanceof LuaRuntimeError ? (
        <LuaErrorDetails
          err={result.error}
          frames={errorFrames(result.error, () => undefined)}
          onOpen={() => {}}
        />
      ) : (
        <div className="sb-wb-message">{errorMessage(result.error)}</div>
      );
  } else if (result.kind === "value" && slice) {
    const { count } = result;
    header = resultsHeading(result, grouped);
    if (count === 0) {
      body = (
        <div className="sb-wbq-note">
          {client.fullIndexCompleted
            ? `No ${sourceLabel(m.source)} objects match.`
            : "The index is still being built."}
        </div>
      );
    } else {
      body = (
        <>
          {count === null ? (
            <div className="sb-wbq-note">
              Showing the first {slice.shown}, counting the rest…
            </div>
          ) : slice.shown < count ? (
            <div className="sb-wbq-note">
              Showing the first {slice.shown} of {count}
            </div>
          ) : null}
          {view === 0 ? (
            <RenderedValue client={client} value={slice.value} />
          ) : (
            <ValueTree client={client} value={slice.value} />
          )}
        </>
      );
    }
  }

  return (
    <section className="sb-wbq-preview" aria-label="Results">
      <div className="sb-wbq-preview-head">
        <span className="sb-wbq-heading">{header}</span>
        <span className="sb-wbq-spacer" />
        {builder.editing ? null : (
          <Button onClick={() => builder.setEditing(true)}>Edit query</Button>
        )}
        <SegmentedControl
          items={[{ label: "Rendered" }, { label: "Lua" }]}
          activeIndex={view}
          onPick={setView}
          ariaLabel="Show the results as"
        />
      </div>
      <div className="sb-wbq-preview-body">{body}</div>
    </section>
  );
}
