import { useMemo } from "preact/hooks";
import type { RowSummary } from "../../../../plug-api/ui/tree_types.ts";
import type { Client } from "../../../client.ts";
import { parseHtmlString } from "../../../lib/dom.ts";
import { buildExtendedMarkdownLanguage } from "../../../markdown_parser/parser.ts";
import { renderMarkdownSummary } from "../../../markdown_renderer/summary.ts";
import { MarkdownText } from "./row_markdown.tsx";

export function RowSummaryText({
  client,
  summary,
  className,
  pageName,
}: {
  client: Client;
  summary: RowSummary;
  className?: string;
  pageName?: string;
}) {
  const node = useMemo(() => {
    const html = renderMarkdownSummary(
      summary.text,
      {
        page:
          typeof summary.sourcePage === "string"
            ? summary.sourcePage
            : (pageName ?? client.currentName()),
        files: client.clientSystem.allKnownFiles,
        language: buildExtendedMarkdownLanguage(
          client.config.get("syntaxExtensions", {}),
        ),
      },
      Number.isFinite(summary.maxChars)
        ? Math.floor(summary.maxChars!)
        : undefined,
    );
    const wrapper = parseHtmlString(html);
    if (typeof summary.suffix === "string" && summary.suffix) {
      wrapper.append((html ? " — " : "") + summary.suffix);
    }
    return wrapper;
  }, [client, summary, pageName]);
  return (
    <MarkdownText
      node={node}
      className={className ?? ""}
      client={client}
      stopLinkClicks
    />
  );
}
