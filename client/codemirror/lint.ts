import { type Diagnostic, linter } from "@codemirror/lint";
import type { Client } from "../client.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import type { LintEvent } from "@silverbulletmd/silverbullet/type/client";

export function plugLinter(client: Client) {
  return linter(async (view): Promise<Diagnostic[]> => {
    const text = view.state.sliceDoc();
    const tree = parse(
      extendedMarkdownLanguage,
      text,
    );
    const results = (await client.dispatchAppEvent("editor:lint", {
      name: client.currentName(),
      pageMeta: client.currentPageMeta(),
      tree,
      text,
    } as LintEvent)).flat();
    return results;
  });
}
