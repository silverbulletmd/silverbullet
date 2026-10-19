import { Component, type ComponentChildren } from "preact";
import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import { SegmentedControl } from "../../../plug-api/ui/segmented_control.tsx";
import type { Client } from "../../client.ts";
import { LuaRuntimeError } from "../../space_lua/runtime.ts";
import type { LogEntry, LogSource } from "../console_log.ts";
import { type ActionDeps, entryActions } from "../entry_actions.ts";
import { highlightLua } from "../highlight_lua.ts";
import {
  frameAt,
  type SourceFrame,
  type SourceLookup,
} from "../source_frames.ts";
import { container, errorMessage } from "../value_preview.ts";
import { ActionMenu } from "./action_menu.tsx";
import {
  errorFrames,
  FrameLabel,
  LuaErrorDetails,
  type OpenTarget,
} from "./lua_error.tsx";
import { RenderedValue } from "./rendered_value.tsx";
import { ValueTree } from "./value_tree.tsx";

/** What rows need besides their entry; kept stable so memoized rows skip re-rendering. */
export type RowContext = {
  client: Client;
  sourceFor: SourceLookup;
  actions: ActionDeps;
  onOpen: OpenTarget;
};

type Message = Extract<LogEntry, { kind: "message" }>;

export function LogView({
  entries,
  ctx,
}: {
  entries: LogEntry[];
  ctx: RowContext;
}) {
  return (
    <div className="sb-wb-log">
      {entries.map((entry) => (
        <LogRow key={entry.id} entry={entry} ctx={ctx} />
      ))}
    </div>
  );
}

// Entries are immutable, so a row only re-renders when given a different entry or ctx
const LogRow = memo(function LogRow({
  entry,
  ctx,
}: {
  entry: LogEntry;
  ctx: RowContext;
}) {
  return (
    <div
      className={rowClass(entry)}
      data-console-ref={entry.kind === "input" ? entry.ref : undefined}
    >
      <RowBoundary>
        <Row entry={entry} ctx={ctx} />
      </RowBoundary>
      <ActionMenu actions={entryActions(entry)} deps={ctx.actions} />
    </div>
  );
});

function rowClass(entry: LogEntry): string {
  if (entry.kind !== "message") return `sb-wb-row sb-wb-row-${entry.kind}`;
  const classes = ["sb-wb-row", `sb-wb-row-${entry.level}`];
  if (entry.level === "error") classes.push("sb-workbench-error");
  if (entry.level === "warn") classes.push("sb-workbench-warning");
  return classes.join(" ");
}

class RowBoundary extends Component<
  { children: ComponentChildren },
  { error?: unknown }
> {
  override state: { error?: unknown } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (this.state.error !== undefined) {
      return (
        <span className="sb-wb-unrenderable">
          {`<unrenderable: ${errorMessage(this.state.error)}>`}
        </span>
      );
    }
    return this.props.children;
  }
}

function Row({ entry, ctx }: { entry: LogEntry; ctx: RowContext }) {
  switch (entry.kind) {
    case "input":
      return (
        <>
          <span className="sb-wb-icon">›</span>
          <pre className="sb-wb-code">
            {highlightLua(entry.code).map((seg, i) =>
              seg.cls ? (
                <span key={i} className={seg.cls}>
                  {seg.text}
                </span>
              ) : (
                seg.text
              ),
            )}
          </pre>
        </>
      );
    case "result":
      return <ResultRow values={entry.values} client={ctx.client} />;
    case "stopped":
      return <span className="sb-wb-muted">Stopped</span>;
    case "message":
      return <MessageRow entry={entry} ctx={ctx} />;
  }
}

function MessageRow({ entry, ctx }: { entry: Message; ctx: RowContext }) {
  // Script load errors log a message string first and the error object last
  const errIndex = entry.args.findIndex((a) => a instanceof LuaRuntimeError);
  if (errIndex !== -1) {
    const context = entry.args
      .slice(0, errIndex)
      .filter((a): a is string => typeof a === "string")
      .join(" ");
    return (
      <LuaErrorRow
        entry={entry}
        err={entry.args[errIndex] as LuaRuntimeError}
        context={context}
        ctx={ctx}
      />
    );
  }
  const origin =
    entry.source === "lua" && entry.origin
      ? frameAt(
          { ref: entry.origin.ref, from: entry.origin.from ?? 0 },
          ctx.sourceFor,
        )
      : undefined;
  return (
    <>
      <span className="sb-wb-icon" />
      <div className="sb-wb-content">
        {entry.args.map((a, i) => (
          <span className="sb-wb-value" key={i}>
            {typeof a === "string" ? (
              <span className="sb-wb-text">{a}</span>
            ) : a instanceof Error ? (
              <JsError err={a} />
            ) : (
              <ValueTree value={a} client={ctx.client} />
            )}
          </span>
        ))}
      </div>
      <Origin frame={origin} entry={entry} ctx={ctx} />
    </>
  );
}

function ResultRow({ values, client }: { values: unknown[]; client: Client }) {
  const [mode, setMode] = useState<"rendered" | "lua">("rendered");
  // Only values with children look different rendered; a number is a number
  const structured = values.map((v) => container(v) !== null);
  const toggleable = structured.includes(true);
  const rendered = toggleable && mode === "rendered";
  return (
    <>
      <span className="sb-wb-icon">↩</span>
      <div className="sb-wb-content">
        {values.length === 0 ? (
          <span className="sb-wb-nil">nil</span>
        ) : (
          values.map((v, i) =>
            rendered && structured[i] ? (
              <RenderedValue key={i} value={v} client={client} />
            ) : (
              <span className="sb-wb-value" key={i}>
                <ValueTree value={v} client={client} />
              </span>
            ),
          )
        )}
      </div>
      {toggleable && (
        <div className="sb-wb-view-toggle">
          <SegmentedControl
            items={[{ label: "Rendered" }, { label: "Lua" }]}
            activeIndex={mode === "rendered" ? 0 : 1}
            onPick={(i) => setMode(i === 0 ? "rendered" : "lua")}
            ariaLabel="Show result as"
          />
        </div>
      )}
    </>
  );
}

function JsError({ err }: { err: Error }) {
  return (
    <span className="sb-wb-jserror">
      <span>{`${err.name}: ${err.message}`}</span>
      {err.stack ? (
        <details className="sb-wb-stack">
          <summary>Stack</summary>
          <pre>{err.stack}</pre>
        </details>
      ) : null}
    </span>
  );
}

function LuaErrorRow({
  entry,
  err,
  context,
  ctx,
}: {
  entry: Message;
  err: LuaRuntimeError;
  context: string;
  ctx: RowContext;
}) {
  const frames = errorFrames(err, ctx.sourceFor);
  return (
    <>
      <span className="sb-wb-icon">✕</span>
      <div className="sb-wb-content">
        {context ? <div className="sb-wb-context">{context}</div> : null}
        <LuaErrorDetails err={err} frames={frames} onOpen={ctx.onOpen} />
      </div>
      <Origin frame={frames[0]} entry={entry} ctx={ctx} />
    </>
  );
}

function Origin({
  frame,
  entry,
  ctx,
}: {
  frame?: SourceFrame;
  entry: Message;
  ctx: RowContext;
}) {
  return (
    <span className="sb-wb-origin">
      {frame ? <FrameLabel frame={frame} onOpen={ctx.onOpen} /> : null}
      <span className="sb-wb-chip" title={SOURCE_TITLES[entry.source]}>
        {entry.scope ?? entry.source}
      </span>
    </span>
  );
}

const SOURCE_TITLES: Record<LogSource, string> = {
  lua: "Space Lua",
  js: "JavaScript",
  plug: "Plug worker",
  sw: "Service worker",
};
