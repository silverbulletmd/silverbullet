import { type Diagnostic, linter } from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import type { Client } from "../client.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import type {
  LintDiagnostic,
  LintEvent,
} from "@silverbulletmd/silverbullet/type/client";

/** Signals the linter to re-run even when the document hasn't changed. */
export const refreshLintEffect = StateEffect.define<null>();

export function plugLinter(client: Client) {
  return linter(async (view): Promise<Diagnostic[]> => {
    const pageMeta = client.currentPageMeta();
    if (!pageMeta) {
      return [];
    }
    const text = view.state.sliceDoc();
    const tree = parse(extendedMarkdownLanguage, text);
    const results: LintDiagnostic[] = (
      await client.dispatchAppEvent("editor:lint", {
        name: client.currentName(),
        pageMeta,
        tree,
        text,
      } as LintEvent)
    ).flat();
    return results.map(toDiagnostic);
  }, {
    needsRefresh: (update) =>
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(refreshLintEffect))
      ),
  });
}

function toDiagnostic(d: LintDiagnostic): Diagnostic {
  const out: Diagnostic = {
    from: d.from,
    to: d.to,
    severity: d.severity,
    message: d.message,
  };
  if (d.markClass) out.markClass = d.markClass;
  if (d.messageHtml) {
    const html = d.messageHtml;
    out.renderMessage = () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = html;
      return wrap;
    };
  }
  return out;
}
