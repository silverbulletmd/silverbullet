import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import type { Client } from "../../client.ts";
import { mdLinkRegex } from "../../markdown_parser/constants.ts";
import { marksTemplate } from "../../space_lua/page_definitions.ts";
import type { PageScope } from "../../space_lua/page_scope.ts";
import { renderPageDirective } from "../../space_lua/render_widget.ts";
import { dirtyRegions } from "../decoration_regions.ts";
import { frontmatterInRange } from "../syntax/frontmatter_block.ts";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
  widgetRenderMode,
} from "../util.ts";
import { directiveCacheKey } from "./directive_actions.ts";
import { assignmentNameOf, directiveExpr } from "./directive_at.ts";
import { LoadingWidget } from "./loading_widget.ts";
import { type InlineWrapper, LuaWidget, OccurrenceKeys } from "./lua_widget.ts";
import { PageLuaErrorWidget } from "./page_lua_error_widget.ts";

const sourceMark = Decoration.mark({ class: "sb-lua-directive-source" });

function isPageLuaBlock(node: SyntaxNode, state: EditorState): boolean {
  const info = node.getChild("CodeInfo");
  return !!info && state.sliceDoc(info.from, info.to).trim() === "page-lua";
}

type PageFacts = {
  /** A `page-lua` block or an assignment directive */
  definitions: boolean;
  /** Marked `#meta/template`, which shows its directives as source */
  template: boolean;
};

/** What in `from`–`to` (the whole page by default) affects every directive */
function scanPageFacts(
  state: EditorState,
  from?: number,
  to?: number,
): PageFacts {
  const facts: PageFacts = { definitions: false, template: false };
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "FrontMatterCode" || node.name === "Hashtag") {
        if (marksTemplate(node.name, state.sliceDoc(node.from, node.to))) {
          facts.template = true;
        }
        return false;
      }
      if (node.name === "FencedCode") {
        if (isPageLuaBlock(node.node, state)) facts.definitions = true;
        return false;
      }
      if (node.name === "LuaDirective") {
        if (assignmentNameOf(node.node, state)) facts.definitions = true;
        return false;
      }
    },
  });
  return facts;
}

/**
 * Whether `from`–`to` holds anything `scanPageFacts` looks for. Page-lua
 * blocks are also numbered across the page, so these always rebuild it all.
 */
function holdsPageFacts(state: EditorState, from: number, to: number) {
  const facts = scanPageFacts(state, from, to);
  return facts.definitions || facts.template;
}

/** The page facts, rescanned only when an edit touches what they come from */
const pageFactsField = StateField.define<PageFacts>({
  create: (state) => scanPageFacts(state),
  update(value, tr) {
    if (!tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) {
      return value;
    }
    const regions = dirtyRegions(tr);
    if (
      regions?.every(
        (r) =>
          !holdsPageFacts(tr.state, r.from, r.to) &&
          !holdsPageFacts(
            tr.startState,
            tr.changes.invertedDesc.mapPos(r.from, -1),
            tr.changes.invertedDesc.mapPos(r.to, 1),
          ),
      )
    ) {
      return value;
    }
    return scanPageFacts(tr.state);
  },
});

/** Whether the page has a `page-lua` block or an assignment directive. */
export function hasPageDefinitions(state: EditorState): boolean {
  return scanPageFacts(state).definitions;
}

/**
 * Whether a directive has to wait for a (re)built page scope: none was ever
 * built, or it is an assignment the last saved scope doesn't know yet.
 */
export function awaitsPageScope(
  scope: PageScope | null | undefined,
  assignmentName: string | undefined,
): boolean {
  if (scope === undefined) return true;
  if (assignmentName === undefined) return false;
  return !scope?.assignments.has(assignmentName);
}

/** The inline formatting and link a directive sits in, outermost first. */
export function directiveWrappers(
  node: SyntaxNode,
  state: EditorState,
  currentPage: string,
): InlineWrapper[] {
  const out: InlineWrapper[] = [];
  for (let p = node.parent; p; p = p.parent) {
    switch (p.name) {
      case "StrongEmphasis":
        out.unshift({ tag: "strong" });
        break;
      case "Emphasis":
        out.unshift({ tag: "em" });
        break;
      case "Strikethrough":
        out.unshift({ tag: "del" });
        break;
      case "Highlight":
        out.unshift({ tag: "span", attrs: { class: "sb-highlight" } });
        break;
      case "Link": {
        mdLinkRegex.lastIndex = 0;
        const url = mdLinkRegex.exec(state.sliceDoc(p.from, p.to))?.groups?.url;
        if (!url) break;
        out.unshift({
          tag: "a",
          attrs: isLocalURL(url)
            ? {
                class: "sb-link",
                href: "#",
                "data-ref": resolveMarkdownLink(currentPage, decodeURI(url)),
              }
            : {
                class: "sb-link",
                href: url,
                target: "_blank",
                rel: "noopener",
              },
        });
        break;
      }
    }
  }
  return out;
}

export function luaDirectivePlugin(client: Client): Extension {
  const decorations = decoratorStateField(
    (state: EditorState, _tr, range) => {
      const widgets: Range<Decoration>[] = [];
      const keys = range?.keys ?? new OccurrenceKeys();

      const renderMode = widgetRenderMode(client, state);
      if (renderMode === "disabled") {
        return Decoration.none;
      }
      const facts = state.field(pageFactsField);
      // Disable rendering of Lua directives in #meta/template pages
      if (facts.template) {
        return Decoration.none;
      }

      // Pages without definitions keep the plain path: no scope, no waiting
      let scope: PageScope | null | undefined = null;
      if (renderMode !== "loading" && facts.definitions) {
        const pageName = client.currentName();
        const scopes = client.clientSystem.pageScopes;
        const latest = scopes.latest(pageName);
        scope = latest.scope;
        if (latest.needsBuild) {
          // A missing page settles as missing: its first save rebuilds us
          scopes.get(pageName).then(
            () => client.editorView.dispatch({}),
            () => {},
          );
        }
      }
      let blockIndex = 0;

      syntaxTree(state).iterate({
        from: range?.from,
        to: range?.to,
        enter: (node) => {
          if (node.name === "FencedCode") {
            if (scope && isPageLuaBlock(node.node, state)) {
              const error = scope.blockErrors.get(blockIndex++);
              if (error) {
                widgets.push(
                  Decoration.widget({
                    widget: new PageLuaErrorWidget(error),
                    block: true,
                    side: 1,
                  }).range(node.to),
                );
              }
            }
            return false;
          }

          if (node.name !== "LuaDirective") {
            return;
          }

          // Shown source is code: it keeps the monospace face when the prose
          // font is proportional.
          const markSource = () =>
            widgets.push(sourceMark.range(node.from, node.to));

          if (isCursorInRange(state, [node.from, node.to])) {
            markSource();
            return;
          }

          const hideSource = () => {
            if (client.ui.viewState.uiOptions.markdownSyntaxRendering) {
              markSource();
              return;
            }
            hideBlockSource(widgets, state, node.from, node.to, "start");
          };

          if (renderMode === "loading") {
            widgets.push(
              Decoration.widget({
                widget: new LoadingWidget(false),
              }).range(node.from),
            );
            hideSource();
            return;
          }

          const expressionText = directiveExpr(
            state.sliceDoc(node.from, node.to),
          );
          const assignmentName = assignmentNameOf(node.node, state);
          if (awaitsPageScope(scope, assignmentName)) {
            widgets.push(
              Decoration.widget({
                widget: new LoadingWidget(false),
              }).range(node.from),
            );
            hideSource();
            return;
          }
          const pageName = client.currentName();
          const scopes = client.clientSystem.pageScopes;
          const currentPageMeta = client.currentPageMeta();
          const baseKey = directiveCacheKey(
            expressionText,
            currentPageMeta?.name,
          );
          const cacheKey = keys.key(
            scope ? `${baseKey}:${scope.key}` : baseKey,
          );
          widgets.push(
            Decoration.widget({
              widget: new LuaWidget({
                client,
                cacheKey,
                expressionText,
                callback: async (bodyText, _page, track) =>
                  renderPageDirective(
                    client,
                    bodyText,
                    currentPageMeta,
                    scope ? await scopes.tryGet(pageName) : null,
                    { assignmentName, track },
                  ),
                host: {
                  kind: "directive",
                  wrappers: directiveWrappers(node.node, state, pageName),
                  label: assignmentName,
                },
              }),
            }).range(node.from),
          );

          hideSource();
        },
      });

      return Decoration.set(widgets, true);
    },
    {
      keyed: true,
      pageWide: (state, from, to) =>
        frontmatterInRange(state, from, to) || holdsPageFacts(state, from, to),
    },
  );
  return [pageFactsField, decorations];
}
