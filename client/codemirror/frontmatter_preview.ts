import { EditorState, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { cleanupJSON } from "@silverbulletmd/silverbullet/lib/json";
import YAML from "js-yaml";
import type { Client } from "../client.ts";
import {
  findFrontmatterBlock,
  selectionIntersectsRange,
} from "./frontmatter_folding.ts";
import { luaDefinitionRef } from "../space_lua.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";
import { widgetRenderMode } from "./util.ts";

export type FrontmatterRenderer = (
  pageMeta: Record<string, unknown>,
) => LuaWidgetContent | Promise<LuaWidgetContent>;

export type FrontmatterPreviewSource = {
  from: number;
  to: number;
  source: string;
  pageMeta: Record<string, unknown>;
};

function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/,\s*|\s+/)
      : [];
  return [
    ...new Set(
      values.map((tag) => String(tag).replace(/^#/, "")).filter(Boolean),
    ),
  ];
}

export function parseFrontmatterPreview(
  state: EditorState,
  pageName: string,
): FrontmatterPreviewSource | undefined {
  const block = findFrontmatterBlock(state);
  if (!block) return;
  const source = state.sliceDoc(block.from, block.to);
  const fenced = /^---\r?\n([\s\S]*?)\r?\n---$/.exec(source);
  if (!fenced) return;

  try {
    const parsed = cleanupJSON(YAML.load(fenced[1]));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    return {
      from: block.from,
      to: block.to,
      source,
      pageMeta: {
        ...(parsed as Record<string, unknown>),
        name: pageName,
        tags: normalizeTags((parsed as Record<string, unknown>).tags),
      },
    };
  } catch {
    return;
  }
}

export function selectFrontmatterRenderer(
  pageMeta: Record<string, unknown>,
  getRenderer: (tag: string) => FrontmatterRenderer | undefined,
): FrontmatterRenderer | undefined {
  if (!Array.isArray(pageMeta.tags)) return;
  for (const tag of pageMeta.tags) {
    const renderer = getRenderer(tag);
    if (renderer) return renderer;
  }
}

export function frontmatterPreviewForState(
  state: EditorState,
  client: Client,
):
  | { source: FrontmatterPreviewSource; render: FrontmatterRenderer }
  | undefined {
  if (
    widgetRenderMode(client) !== "ready" ||
    client.ui.viewState.uiOptions.markdownSyntaxRendering
  ) {
    return;
  }
  const source = parseFrontmatterPreview(state, client.currentName());
  if (!source || selectionIntersectsRange(state, source.from, source.to)) {
    return;
  }
  const render = selectFrontmatterRenderer(source.pageMeta, (tag) =>
    client.config.get<FrontmatterRenderer | undefined>(
      ["tags", tag, "renderFrontmatter"],
      undefined,
    ),
  );
  return render ? { source, render } : undefined;
}

class FrontmatterPreviewWidget extends WidgetType {
  private content?: LuaWidget;

  constructor(
    private client: Client,
    private source: FrontmatterPreviewSource,
    private render: FrontmatterRenderer,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "sb-frontmatter-preview";
    const edit = (event: MouseEvent) => {
      const target = event.target;
      const interactive =
        target instanceof Element
          ? target.closest(
              "a, button, input, select, textarea, [role=button], [contenteditable]",
            )
          : null;
      if (
        !event.altKey &&
        interactive &&
        interactive !== container &&
        container.contains(interactive)
      ) {
        return;
      }
      if (view.state.readOnly || this.client.isReadOnlyMode()) return;
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.source.from + 4 } });
      view.focus();
    };
    container.addEventListener("mousedown", edit, true);
    this.content = new LuaWidget({
      client: this.client,
      cacheKey: `frontmatter:${this.client.currentName()}:${this.source.source}`,
      expressionText: "",
      callback: async () => {
        try {
          const result = await this.render(this.source.pageMeta);
          return result == null ||
            (typeof result === "string" && !result.trim())
            ? {
                _isWidget: true,
                markdown: "**Frontmatter preview returned no content**",
                display: "block",
              }
            : result;
        } catch (error) {
          console.error("Error rendering frontmatter preview", error);
          return {
            _isWidget: true,
            markdown: "**Could not render frontmatter preview**",
            display: "block",
          };
        }
      },
      inPage: true,
      editOnly: true,
      editPos: this.source.from + 4,
      definitionRef: luaDefinitionRef(this.render),
      renderEmpty: true,
    });
    container.appendChild(this.content.toDOM());
    return container;
  }

  override destroy(): void {
    this.content?.destroy();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof FrontmatterPreviewWidget &&
      other.source.source === this.source.source &&
      other.source.pageMeta.name === this.source.pageMeta.name &&
      other.render === this.render
    );
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export function frontmatterPreviewPlugin(client: Client): Extension {
  const decorate = (state: EditorState): DecorationSet => {
    const preview = frontmatterPreviewForState(state, client);
    if (!preview) return Decoration.none;
    return Decoration.set([
      Decoration.replace({
        widget: new FrontmatterPreviewWidget(
          client,
          preview.source,
          preview.render,
        ),
        block: true,
      }).range(preview.source.from, preview.source.to),
    ]);
  };

  return StateField.define<DecorationSet>({
    create: decorate,
    update: (_value, transaction) => decorate(transaction.state),
    provide: (field) => EditorView.decorations.from(field),
  });
}
