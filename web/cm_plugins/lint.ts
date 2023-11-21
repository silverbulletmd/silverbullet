import { Diagnostic, linter } from "@codemirror/lint";
import type { Client } from "../client.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import buildMarkdown from "../../common/markdown_parser/parser.ts";
import { LintEvent } from "$sb/app_event.ts";

export function plugLinter(client: Client) {
  return linter(async (view): Promise<Diagnostic[]> => {
    const tree = parse(
      buildMarkdown(client.system.mdExtensions),
      view.state.sliceDoc(),
    );
    const results = (await client.dispatchAppEvent("editor:lint", {
      name: client.currentPage!,
      tree: tree,
    } as LintEvent)).flat();
    return results;
  });
}
