import { Button } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { Client } from "../../client.ts";
import { LuaRuntimeError } from "../../space_lua/runtime.ts";
import type { QueryBuilder } from "../query_builder.ts";
import { isGrouped } from "../query_edits.ts";
import {
  firstRows,
  previewDelay,
  previewSlice,
  rowCount,
} from "../query_preview.ts";
import { evalQueryText } from "../query_source.ts";
import { generateQuery } from "../query_text.ts";
import { errorMessage } from "../value_preview.ts";
import { errorFrames, LuaErrorDetails } from "./lua_error.tsx";
import { RenderedValue } from "./rendered_value.tsx";
import { ValueTree } from "./value_tree.tsx";

type Result =
  | { kind: "pending" }
  | { kind: "value"; value: unknown; matched: number }
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
  // Run without the limit, for "N of M": the limit only cuts the rows off
  const text = m
    ? generateQuery({ ...m, limit: null }, builder.fields, { wrap: false })
    : null;

  const lastRun = useRef(0);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        lastRun.current = Date.now();
        try {
          const all = await evalQueryText(client, text);
          const value = limit === null ? all : firstRows(all, limit);
          if (!cancelled) {
            setResult({ kind: "value", value, matched: rowCount(all) });
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
  }, [client, text, limit, builder.dataVersion]);

  if (!m) return <div className="sb-wbq-preview" />;
  const grouped = isGrouped(m);
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
  } else if (result.kind === "value") {
    const slice = previewSlice(result.value);
    const count = rowCount(result.value);
    header = grouped
      ? `${count} group${count === 1 ? "" : "s"}`
      : count === result.matched
        ? `${count} result${count === 1 ? "" : "s"}`
        : `${count} of ${result.matched} results`;
    if (count === 0) {
      body = (
        <div className="sb-wbq-note">
          {client.fullIndexCompleted
            ? `No ${m.tag} objects match.`
            : "The index is still being built."}
        </div>
      );
    } else {
      body = (
        <>
          {slice.shown < slice.total ? (
            <div className="sb-wbq-note">
              Showing the first {slice.shown} of {slice.total}
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
