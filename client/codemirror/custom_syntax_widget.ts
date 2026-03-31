import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import type { Client } from "../client.ts";
import { LuaWidget, type LuaWidgetContent } from "./lua_widget.ts";
import type { CustomSyntaxSpec } from "../markdown_parser/custom_syntax.ts";

// Extends the parser spec with editor-specific fields
export type CustomSyntaxExtension = CustomSyntaxSpec & {
  // CSS class applied to the start delimiter in the editor
  startMarkerClass?: string;
  // CSS class applied to the body content between delimiters
  bodyClass?: string;
  // CSS class applied to the end delimiter in the editor
  endMarkerClass?: string;
  // CSS class applied to the rendered widget when cursor is outside the region
  renderClass?: string;
  // Callback function(body, pageName) returning widget content for live preview
  renderWidget?: (
    body: string,
    pageName: string,
  ) => LuaWidgetContent | Promise<LuaWidgetContent>;
  // Deprecated: use renderWidget instead (kept for backwards compatibility)
  render?: (
    body: string,
    pageName: string,
  ) => LuaWidgetContent | Promise<LuaWidgetContent>;
  // Callback function(body, pageName) returning HTML for markdown-to-HTML rendering
  renderHtml?: (
    body: string,
    pageName: string,
  ) => string | HTMLElement | Promise<string | HTMLElement>;
};

export function customSyntaxPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    if (!client.clientSystem.scriptsLoaded) {
      return Decoration.none;
    }

    const syntaxExtensions: Record<string, CustomSyntaxExtension> =
      client.config.get("syntaxExtensions", {});

    if (Object.keys(syntaxExtensions).length === 0) {
      return Decoration.none;
    }

    syntaxTree(state).iterate({
      enter: (node) => {
        const spec = syntaxExtensions[node.name];
        if (!spec) {
          return;
        }

        // Apply per-part CSS class decorations
        const markName = `${spec.name}Mark`;
        const bodyName = `${spec.name}Body`;
        const bodyNode = node.node.getChild(bodyName);

        if (spec.startMarkerClass || spec.endMarkerClass) {
          const marks = node.node.getChildren(markName);
          if (marks.length >= 1 && spec.startMarkerClass) {
            widgets.push(
              Decoration.mark({ class: spec.startMarkerClass }).range(
                marks[0].from,
                marks[0].to,
              ),
            );
          }
          if (marks.length >= 2 && spec.endMarkerClass) {
            widgets.push(
              Decoration.mark({ class: spec.endMarkerClass }).range(
                marks[marks.length - 1].from,
                marks[marks.length - 1].to,
              ),
            );
          }
        }

        if (spec.bodyClass && bodyNode && bodyNode.from < bodyNode.to) {
          widgets.push(
            Decoration.mark({ class: spec.bodyClass }).range(
              bodyNode.from,
              bodyNode.to,
            ),
          );
        }

        // When cursor is outside and a render callback exists, show widget
        const widgetRenderFn = spec.renderWidget ?? spec.render;
        if (widgetRenderFn && !isCursorInRange(state, [node.from, node.to])) {
          const bodyText = bodyNode
            ? state.sliceDoc(bodyNode.from, bodyNode.to)
            : "";
          const codeText = state.sliceDoc(node.from, node.to);

          widgets.push(
            Decoration.widget({
              widget: new LuaWidget({
                client,
                cacheKey: `custom-syntax:${spec.name}:${bodyText}:${client.currentName()}`,
                expressionText: bodyText,
                codeText,
                callback: async (body, pageName) => {
                  try {
                    const result = await widgetRenderFn(body, pageName);
                    // Inject renderClass into widget content if configured
                    if (
                      spec.renderClass &&
                      result &&
                      typeof result === "object" &&
                      !Array.isArray(result)
                    ) {
                      result.cssClasses = [
                        ...(result.cssClasses || []),
                        spec.renderClass,
                      ];
                    }
                    return result;
                  } catch (e: any) {
                    return `**Error in ${spec.name} render:** ${e.message}`;
                  }
                },
                inPage: true,
              }),
            }).range(node.to),
          );

          if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
            widgets.push(invisibleDecoration.range(node.from, node.to));
          }
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
