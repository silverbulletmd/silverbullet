import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
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
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
  widgetRenderMode,
} from "../util.ts";
import { directiveCacheKey } from "./directive_actions.ts";
import { assignmentNameOf, directiveExpr } from "./directive_at.ts";
import { LoadingWidget } from "./loading_widget.ts";
import { type InlineWrapper, LuaWidget } from "./lua_widget.ts";
import { PageLuaErrorWidget } from "./page_lua_error_widget.ts";

function isPageLuaBlock(node: SyntaxNode, state: EditorState): boolean {
  const info = node.getChild("CodeInfo");
  return !!info && state.sliceDoc(info.from, info.to).trim() === "page-lua";
}

/** Whether the page has a `page-lua` block or an assignment directive. */
export function hasPageDefinitions(state: EditorState): boolean {
  let found = false;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found) return false;
      if (node.name === "FencedCode") {
        if (isPageLuaBlock(node.node, state)) found = true;
        return false;
      }
      if (node.name === "LuaDirective") {
        if (assignmentNameOf(node.node, state)) found = true;
        return false;
      }
    },
  });
  return found;
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

export function luaDirectivePlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    let shouldRender = true;

    const renderMode = widgetRenderMode(client);
    if (renderMode === "disabled") {
      return Decoration.none;
    }

    // Pages without definitions keep the plain path: no scope, no waiting
    let scope: PageScope | null | undefined = null;
    if (renderMode !== "loading" && hasPageDefinitions(state)) {
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
      enter: (node) => {
        // Disable rendering of Lua directives in #meta/template pages
        if (marksTemplate(node.name, state.sliceDoc(node.from, node.to))) {
          shouldRender = false;
          return;
        }

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

        if (isCursorInRange(state, [node.from, node.to])) {
          return;
        }

        const hideSource = () => {
          if (client.ui.viewState.uiOptions.markdownSyntaxRendering) return;
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
        const cacheKey = scope ? `${baseKey}:${scope.key}` : baseKey;
        widgets.push(
          Decoration.widget({
            widget: new LuaWidget({
              client,
              cacheKey,
              expressionText,
              callback: async (bodyText, _page, onPageVarsRead) =>
                renderPageDirective(
                  client,
                  bodyText,
                  currentPageMeta,
                  scope ? await scopes.tryGet(pageName) : null,
                  { assignmentName, onPageVarsRead },
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

    if (!shouldRender) {
      return Decoration.set([]);
    }

    return Decoration.set(widgets, true);
  });
}
