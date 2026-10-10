import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import type { Client } from "../../client.ts";
import { wikiLinkRegex } from "../../markdown_parser/constants.ts";
import { decoratorStateField, isCursorInRange } from "../util.ts";
import { InlineMarkdownWidget } from "../widgets/inline_markdown_widget.ts";
import { processWikiLink, type WikiLinkMatch } from "./wiki_link_processor.ts";

export function attributePlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    const shortWikiLinks = client.config.get("shortWikiLinks", true);

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.type.name !== "Attribute") {
          return;
        }
        const attributeText = state.sliceDoc(node.from, node.to);

        const attributeName = attributeText.slice(
          1,
          attributeText.indexOf(":"),
        );
        const attributeValue = attributeText
          .slice(attributeText.indexOf(":") + 1, attributeText.length - 1)
          .trim();

        if (!isCursorInRange(state, [node.from, node.to])) {
          widgets.push(
            Decoration.mark({
              tagName: "span",
              class: "sb-attribute",
              attributes: {
                [`data-${attributeName}`]: attributeValue,
              },
            }).range(node.from, node.to),
          );
        }

        const valueNode = node.node.getChild("AttributeValue");
        if (!valueNode) {
          return;
        }
        const valueText = state.sliceDoc(valueNode.from, valueNode.to);
        if (valueText.includes("${")) {
          if (!isCursorInRange(state, [valueNode.from, valueNode.to])) {
            widgets.push(
              Decoration.replace({
                widget: new InlineMarkdownWidget(client, valueText),
              }).range(valueNode.from, valueNode.to),
            );
          }
          return;
        }
        wikiLinkRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = wikiLinkRegex.exec(valueText)) !== null) {
          if (!match.groups) {
            continue;
          }
          const from = valueNode.from + match.index;
          const to = from + match[0].length;
          const wikiLinkMatch: WikiLinkMatch = {
            leadingTrivia: match.groups.leadingTrivia,
            stringRef: match.groups.stringRef,
            alias: match.groups.alias,
            trailingTrivia: match.groups.trailingTrivia,
          };
          widgets.push(
            ...processWikiLink({
              from,
              to,
              match: wikiLinkMatch,
              matchFrom: from,
              matchTo: to,
              client,
              shortWikiLinks,
              state,
              callback: (event, ref) => {
                if (event.altKey) {
                  client.editorView.dispatch({
                    selection: {
                      anchor: from + wikiLinkMatch.leadingTrivia.length,
                    },
                  });
                  client.focus();
                  return;
                }
                void client.navigate(
                  ref,
                  false,
                  event.ctrlKey || event.metaKey,
                );
              },
            }),
          );
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
