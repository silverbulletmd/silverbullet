// A `${…}`'s own menu, built and run here for both of its handles: the
// rendered widget's ⋯ / ⋮ and, while a block one's source is being edited,
// the ⋮ line handle on its first line
import type { Client } from "../../client.ts";
import type { PopupEntry } from "../../components/popup_menu.ts";
import type { RenderContext } from "../../markdown_renderer/compose.ts";
import { evaluateExpression } from "../../markdown_renderer/compose_client.ts";
import { EDIT_QUERY_COMMAND } from "../../navigator/views/workbench.ts";
import {
  blockDirectiveAt,
  showBlockDirectiveResult,
} from "./block_directive.ts";
import { bindMenu, joinGroups } from "./block_menu.ts";
import { bakeDirective, copyValue } from "./directive_actions.ts";
import { type DirectiveTarget, isQueryExpression } from "./directive_at.ts";
import { widgetMenuItem } from "./widget_menu.ts";

export type DirectiveActionId = "edit" | "show" | "query" | "bake" | "copy";

/**
 * Which handle the menu opens from: the rendered widget's ⋯, or the ⋮ beside
 * its source while it is being edited
 */
export type DirectiveMenuMode = "rendered" | "editing";

export type DirectiveMenuCaps = {
  /** The page can be edited: Edit source / Show result */
  edit: boolean;
  /** A `query[[…]]` the Workbench's query builder can open */
  query: boolean;
  bake: boolean;
  /** Rendered only: the shown result has Markdown to copy */
  copy: boolean;
};

/**
 * A `${…}`'s own menu: Edit source (rendered) or Show result (editing), Edit
 * in query builder, Bake into page, Copy as Markdown (rendered); each where
 * `caps` allows it. Move up / Move down / Delete for a block one are the ⋮'s
 * (`blockActionEntries`).
 */
export function directiveMenuEntries(
  mode: DirectiveMenuMode,
  caps: DirectiveMenuCaps,
): PopupEntry<DirectiveActionId>[] {
  const group = (items: (PopupEntry<DirectiveActionId> | false)[]) =>
    items.filter((i): i is PopupEntry<DirectiveActionId> => !!i);
  return joinGroups([
    group([
      caps.edit &&
        (mode === "rendered"
          ? widgetMenuItem("edit", "Edit source")
          : widgetMenuItem("show", "Show result")),
      caps.edit &&
        caps.query &&
        widgetMenuItem("query", "Edit in query builder"),
    ]),
    group([
      caps.edit && caps.bake && widgetMenuItem("bake", "Bake into page"),
      mode === "rendered" &&
        caps.copy &&
        widgetMenuItem("copy", "Copy as Markdown"),
    ]),
  ]);
}

/** What the menu can do with the `${…}` `directive`, besides the shown value */
export function directiveMenuCaps(
  client: Pick<Client, "isReadOnlyMode">,
  directive: Pick<DirectiveTarget, "expr" | "assignmentName">,
  shown: { copy: boolean; bake: boolean },
): DirectiveMenuCaps {
  // Baking or rewriting an assignment would drop its definition
  const assignment = !!directive.assignmentName;
  return {
    edit: !client.isReadOnlyMode(),
    query: !assignment && isQueryExpression(directive.expr),
    bake: !assignment && shown.bake,
    copy: shown.copy,
  };
}

export type DirectiveMenuHost = {
  /** The shown value, for Copy and Bake; evaluated when absent */
  value?: { value: unknown; ctx?: RenderContext };
  /** Edit source as the host reveals it; default: the cursor into it */
  edit?: () => void;
};

/**
 * A `${…}`'s own menu (`directiveMenuEntries`), each item running its action
 * on the `${…}` `target` finds when picked. Edit source and Copy given by
 * `host` need none.
 */
export function directiveMenu(
  client: Client,
  mode: DirectiveMenuMode,
  caps: DirectiveMenuCaps,
  target: () => DirectiveTarget | undefined,
  host: DirectiveMenuHost = {},
): PopupEntry<DirectiveActionId>[] {
  return bindMenu(directiveMenuEntries(mode, caps), (id) =>
    runDirectiveAction(client, id, target, host),
  );
}

async function runDirectiveAction(
  client: Client,
  id: DirectiveActionId,
  target: () => DirectiveTarget | undefined,
  host: DirectiveMenuHost,
): Promise<void> {
  if (id === "edit" && host.edit) {
    host.edit();
    return;
  }
  if (id === "copy" && host.value) {
    await copyValue(client, host.value.value, host.value.ctx);
    return;
  }
  const at = target();
  if (!at) return;
  const view = client.editorView;
  const shown = async () =>
    host.value ??
    (await evaluateExpression(client, at.expr, client.currentPageMeta()));
  switch (id) {
    case "edit":
      view.dispatch({ selection: { anchor: at.from } });
      client.focus();
      return;
    case "show": {
      const block = blockDirectiveAt(view.state, at.from);
      if (block) view.dispatch(showBlockDirectiveResult(view.state, block));
      client.focus();
      return;
    }
    case "query":
      await client.runCommandByName(EDIT_QUERY_COMMAND, [at]);
      return;
    case "bake": {
      const { value, ctx } = await shown();
      await bakeDirective(client, at, value, ctx);
      return;
    }
    case "copy": {
      const { value, ctx } = await shown();
      await copyValue(client, value, ctx);
      return;
    }
  }
}
