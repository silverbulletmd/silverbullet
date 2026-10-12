import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  copyBakedSection,
  editBakedExpression,
  unbakeSection,
  updateBakedSection,
} from "../../baked_sections/bake.ts";
import {
  type BakedSection,
  bakedOpenerExpr,
  isBakedCloser,
} from "../../baked_sections/regions.ts";
import type { Client } from "../../client.ts";
import { openPopupMenu, type PopupEntry } from "../../components/popup_menu.ts";
import { decoratorStateField, isCursorInRange } from "../util.ts";
import { moreIcon, widgetActionIcon } from "../widgets/widget_menu.ts";

export type BakedActionId = "update" | "edit" | "copy" | "unbake";

const unbakeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-rotate-ccw"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;

export function bakedMenuEntries(
  readOnly: boolean,
): PopupEntry<BakedActionId>[] {
  const copy: PopupEntry<BakedActionId> = {
    kind: "item",
    id: "copy",
    label: "Copy as Markdown",
    icon: widgetActionIcon("copy"),
  };
  if (readOnly) return [copy];
  return [
    {
      kind: "item",
      id: "update",
      label: "Update",
      icon: widgetActionIcon("reload"),
    },
    {
      kind: "item",
      id: "edit",
      label: "Edit expression",
      icon: widgetActionIcon("edit"),
    },
    copy,
    { kind: "separator" },
    { kind: "item", id: "unbake", label: "Unbake", icon: unbakeIcon },
  ];
}

function runBakedAction(client: Client, id: BakedActionId, pos: number) {
  switch (id) {
    case "update":
      return updateBakedSection(client, pos);
    case "edit":
      return editBakedExpression(client, pos);
    case "copy":
      return copyBakedSection(client, pos);
    case "unbake":
      unbakeSection(client, pos);
      return;
  }
}

/** Stands in for a hidden opening marker: names the expression, offers ⋯. */
class BakedHeaderWidget extends WidgetType {
  constructor(
    readonly expr: string,
    readonly start: number,
    readonly readOnly: boolean,
    readonly client: Client,
  ) {
    super();
  }

  toDOM() {
    const header = document.createElement("div");
    header.className = "sb-baked-header";
    const label = document.createElement("span");
    label.className = "sb-baked-label";
    label.textContent = "Baked";
    const expr = document.createElement("code");
    expr.className = "sb-baked-expr";
    expr.textContent = this.expr.replace(/\s+/g, " ");
    expr.title = this.expr;
    // Clicking the expression edits it, the way clicking hidden markup does
    expr.addEventListener("mousedown", (e) => {
      e.preventDefault();
      editBakedExpression(this.client, this.start);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sb-widget-menu-button sb-baked-menu-button";
    button.title = "Baked section actions";
    button.setAttribute("aria-label", "Baked section actions");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = moreIcon;
    let closeMenu: (() => void) | undefined;
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (button.getAttribute("aria-expanded") === "true") {
        closeMenu?.();
        return;
      }
      closeMenu = openPopupMenu(
        button,
        bakedMenuEntries(this.readOnly),
        (id) => {
          Promise.resolve(runBakedAction(this.client, id, this.start)).catch(
            console.error,
          );
        },
        "sb-widget-menu",
      );
    });

    header.append(label, expr, button);
    return header;
  }

  override eq(other: BakedHeaderWidget) {
    return (
      other.expr === this.expr &&
      other.start === this.start &&
      other.readOnly === this.readOnly
    );
  }

  override ignoreEvent() {
    return true;
  }
}

/**
 * Baked sections as the parser sees them: an opening marker paired with the
 * next closing one. Markers in code blocks aren't marker nodes, so they never
 * pair; an opener with no closer yet (still being typed) is left alone.
 */
export function bakedSectionsInTree(state: EditorState): BakedSection[] {
  const sections: BakedSection[] = [];
  let open: { expr: string; from: number; to: number } | undefined;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "CommentMarkerBlock") return;
      const text = state.doc.sliceString(node.from, node.to);
      const expr = bakedOpenerExpr(text);
      if (expr !== null) {
        const from = node.from + text.indexOf("<!--#lua");
        open = { expr, from, to: node.to };
      } else if (open && isBakedCloser(text)) {
        const closer = node.from + text.indexOf("<!--/lua-->");
        sections.push({
          expr: open.expr,
          start: open.from,
          end: closer + "<!--/lua-->".length,
          bodyFrom: open.to,
          bodyTo: closer,
        });
        open = undefined;
      }
      return false;
    },
  });
  return sections;
}

/** Stands in for a hidden closing marker, on that marker's own line. */
class BakedEndWidget extends WidgetType {
  toDOM() {
    const end = document.createElement("span");
    end.className = "sb-baked-end";
    end.textContent = "End baked";
    return end;
  }

  override eq() {
    return true;
  }
}

function decorateBakedSections(state: EditorState, client: Client) {
  const decorations: Range<Decoration>[] = [];
  for (const section of bakedSectionsInTree(state)) {
    if (isCursorInRange(state, [section.start, section.end])) continue;
    decorations.push(
      Decoration.replace({
        widget: new BakedHeaderWidget(
          section.expr,
          section.start,
          state.readOnly,
          client,
        ),
      }).range(section.start, section.bodyFrom),
      Decoration.replace({ widget: new BakedEndWidget() }).range(
        section.bodyTo,
        section.end,
      ),
    );
  }
  return Decoration.set(decorations, true);
}

export function bakedSectionPlugin(client: Client) {
  return decoratorStateField((state) => decorateBakedSections(state, client));
}
