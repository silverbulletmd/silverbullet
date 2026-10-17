import { Button } from "@silverbulletmd/silverbullet/ui";
import { useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import { showView } from "../../navigator/navigator.ts";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import { copyText } from "../action.ts";
import type { ConsoleSession } from "../console_session.ts";
import { highlightLua } from "../highlight_lua.ts";
import type { QueryBuilder } from "../query_builder.ts";
import { insertRange } from "../query_target.ts";
import { generateQuery } from "../query_text.ts";

/** Whether the target is a query opened from a page, which the bar replaces */
function replacing(builder: QueryBuilder): boolean {
  const t = builder.target;
  return !!t && t.to > t.from;
}

/**
 * Puts `text` where the `/Query…` slash command was typed or over the query
 * it was opened from, or at the editor's cursor when there's no such place or
 * its page isn't open.
 */
export function insertQuery(
  client: Client,
  builder: QueryBuilder,
  text: string,
): void {
  const view = client.editorView;
  const target = builder.target;
  const replace = replacing(builder);
  const { from, to, elsewhere } = insertRange(
    target,
    client.currentName(),
    view.state.doc.length,
    view.state.selection.main.head,
  );
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  if (elsewhere) {
    client.ui.flashNotification(
      `Inserted at the cursor: ${target?.page} is no longer open`,
    );
    builder.setTarget(null);
  } else if (replace) {
    client.ui.flashNotification("Updated the query on the page");
    // Still the page's query: later changes update it again
    builder.setTarget({ page: target!.page, from, to: from + text.length });
  } else {
    client.ui.flashNotification("Inserted");
    builder.setTarget(null);
  }
}

export function Highlighted({ code }: { code: string }) {
  return (
    <pre className="sb-wbq-code">
      {highlightLua(code).map((seg, i) =>
        seg.cls ? (
          <span key={i} className={seg.cls}>
            {seg.text}
          </span>
        ) : (
          seg.text
        ),
      )}
    </pre>
  );
}

/** The generated query, kept in the background: one line until shown. */
export function QueryBar({
  client,
  session,
  builder,
}: {
  client: Client;
  session: ConsoleSession;
  builder: QueryBuilder;
}) {
  const [open, setOpen] = useState(false);
  const m = builder.model;
  if (!m) return null;
  const text = generateQuery(m, builder.fields);
  const target = builder.target;

  return (
    <section className="sb-wbq-bar" aria-label="Query">
      <div className="sb-wbq-bar-line">
        <span className="sb-wbq-bar-label">Query</span>
        {open ? (
          <span className="sb-wbq-spacer" />
        ) : (
          <code className="sb-wbq-oneline">{text.replace(/\s+/g, " ")}</code>
        )}
        {open ? null : (
          <button
            type="button"
            className="sb-wbq-link"
            onClick={() => setOpen(true)}
          >
            Show
          </button>
        )}
        <span className="sb-wbq-actions">
          <Button
            variant={target ? "primary" : "default"}
            onClick={() => insertQuery(client, builder, text)}
          >
            {replacing(builder) ? "Update page" : "Insert at cursor"}
          </Button>
          <Button onClick={() => void copyText(client, text)}>Copy</Button>
          <Button
            onClick={() => {
              void session.run(
                generateQuery(m, builder.fields, { wrap: false }),
              );
              void showView(WORKBENCH_VIEW, { segment: "Console" });
            }}
          >
            Run in Console
          </Button>
        </span>
        {open ? (
          <button
            type="button"
            className="sb-wbq-x"
            aria-label="Hide query text"
            title="Hide query text"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        ) : null}
      </div>
      {target ? (
        <div className="sb-wbq-banner">
          {replacing(builder)
            ? `Update page replaces the query you opened on ${target.page}.`
            : `Insert at cursor goes where you typed /Query… on ${target.page}.`}
        </div>
      ) : null}
      {open ? <Highlighted code={text} /> : null}
    </section>
  );
}
