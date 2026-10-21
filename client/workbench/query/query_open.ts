/**
 * Opening the Query tab's query editor on a spot in the page: where `/Query…`
 * was typed, or a `query[[…]]` the page already has, which the editor then
 * updates in place.
 */
import type { Client } from "../../client.ts";
import { directiveAt } from "../../codemirror/widgets/directive_at.ts";
import { showView } from "../../navigator/navigator.ts";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import type { InsertTarget, QueryBuilder } from "./query_builder.ts";
import { parseQuery, querySource } from "./query_parse.ts";
import { loadFields } from "./query_source.ts";
import { followTarget } from "./query_target.ts";

/** Shows the query editor, bound to `target` on the open page */
export async function showQueryEditor(
  client: Client,
  builder: QueryBuilder,
  target: InsertTarget,
): Promise<void> {
  builder.setTarget(target);
  followTarget(client.editorView, builder);
  builder.setEditing(true);
  await showView(WORKBENCH_VIEW, { segment: "Query" });
}

/** A `${…}` on the page: its whole span, and the expression inside */
export type QuerySpan = { from: number; to: number; expr: string };

/**
 * Opens `span`, or else the `${…}` at the cursor, in the query editor; says
 * why when the builder can't show it.
 */
export async function openQuery(
  client: Client,
  builder: QueryBuilder,
  span?: QuerySpan,
): Promise<void> {
  const view = client.editorView;
  const found = span ?? directiveAt(view.state, view.state.selection.main.head);
  const fail = (reason: string) => {
    client.ui.flashNotification(reason, "error");
  };
  if (!found) return fail("Put the cursor in a ${query[[…]]} to edit it");
  if (client.isReadOnlyMode()) return fail("This page is read-only");
  const source = querySource(found.expr);
  if (!source) {
    const parsed = parseQuery(found.expr, []);
    return fail(parsed.ok ? "This isn't a query over a tag" : parsed.reason);
  }
  const { fields } = await loadFields(client, source);
  const parsed = parseQuery(found.expr, fields);
  if (!parsed.ok) return fail(`Can't edit this query: ${parsed.reason}`);
  builder.openModel(parsed.model, fields);
  await showQueryEditor(client, builder, {
    page: client.currentName(),
    from: found.from,
    to: found.to,
  });
  for (const note of parsed.notes) client.ui.flashNotification(note, "info");
}
