import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  LintDiagnostic,
  LintEvent,
} from "@silverbulletmd/silverbullet/type/client";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { parse } from "./markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "./markdown_parser/parser.ts";
import { isLuaWidgetError } from "./space_lua/render_lua_markdown.ts";

export type SpaceLintDiagnostic = {
  page: string;
  line: number;
  column: number;
  severity: LintDiagnostic["severity"];
  message: string;
  source: string;
};

export type ListenerDiagnostics = {
  listener?: string;
  diagnostics: LintDiagnostic[];
};

export type LintPagesDeps = {
  listPageNames: () => Promise<string[]>;
  readPage: (name: string) => Promise<{ text: string; meta: PageMeta }>;
  dispatchLint: (event: LintEvent) => Promise<ListenerDiagnostics[]>;
  renderDirective: (expressionText: string, pageMeta: PageMeta) => Promise<any>;
  luaCodeWidget: (
    lang: string,
  ) => ((body: string, pageMeta: PageMeta) => Promise<any>) | undefined;
};

/**
 * Hints annotate the page (e.g. the X-Ray lens) rather than report problems,
 * so they are left out.
 */
const reportedSeverities = new Set<LintDiagnostic["severity"]>([
  "error",
  "warning",
  "info",
]);

export function offsetToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

function widgetErrorMessage(result: unknown): string | undefined {
  if (!isLuaWidgetError(result)) return undefined;
  return (result as string).replace(/^\*\*([^*]+):\*\*\s*/, "$1: ");
}

async function widgetDiagnostics(
  deps: LintPagesDeps,
  tree: ParseTree,
  pageMeta: PageMeta,
): Promise<{ from: number; message: string }[]> {
  const found: { from: number; message: string }[] = [];
  const check = async (from: number, render: () => Promise<any>) => {
    try {
      const message = widgetErrorMessage(await render());
      if (message) found.push({ from, message });
    } catch (e: any) {
      found.push({ from, message: e?.message ?? String(e) });
    }
  };
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "LuaDirective") {
      const expressionText = renderToText(node).slice(2, -1);
      await check(node.from!, () =>
        deps.renderDirective(expressionText, pageMeta),
      );
      return true;
    }
    if (node.type === "FencedCode") {
      const lang = findNodeOfType(node, "CodeInfo")?.children?.[0]?.text;
      const render = lang ? deps.luaCodeWidget(lang) : undefined;
      if (render) {
        const codeText = findNodeOfType(node, "CodeText");
        const body = codeText ? renderToText(codeText) : "";
        await check(node.from!, () => render(body, pageMeta));
      }
      return true;
    }
    return false;
  });
  return found;
}

async function lintPage(
  deps: LintPagesDeps,
  name: string,
): Promise<{ from: number; diagnostic: SpaceLintDiagnostic }[]> {
  let page: { text: string; meta: PageMeta };
  try {
    page = await deps.readPage(name);
  } catch (e: any) {
    return [
      {
        from: 0,
        diagnostic: {
          page: name,
          line: 1,
          column: 1,
          severity: "error",
          message: `Could not read page: ${e?.message ?? e}`,
          source: "page",
        },
      },
    ];
  }
  const { text, meta } = page;
  const tree = parse(extendedMarkdownLanguage, text);
  const raw: {
    from: number;
    severity: SpaceLintDiagnostic["severity"];
    message: string;
    source: string;
  }[] = [];
  for (const { listener, diagnostics } of await deps.dispatchLint({
    name,
    pageMeta: meta,
    tree,
    text,
  })) {
    if (!Array.isArray(diagnostics)) continue;
    for (const d of diagnostics) {
      if (!reportedSeverities.has(d.severity)) continue;
      raw.push({
        from: d.from,
        severity: d.severity,
        message: d.message,
        source: d.source ?? listener ?? "listener",
      });
    }
  }
  // Not an editor:lint listener: in the editor, widgets render and show
  // their own errors, so only space.lint renders them to find failures.
  for (const w of await widgetDiagnostics(deps, tree, meta)) {
    raw.push({ ...w, severity: "error", source: "widget" });
  }
  return raw.map(({ from, ...rest }) => ({
    from,
    diagnostic: { page: name, ...offsetToLineColumn(text, from), ...rest },
  }));
}

/**
 * Lint pages the way the editor does (the `editor:lint` listeners, minus
 * `hint` diagnostics) and also render their Lua directives and Lua code
 * widgets, reporting those that fail.
 * Without page names, lints every page outside `Library/`.
 */
export async function lintPages(
  deps: LintPagesDeps,
  pages?: string[],
): Promise<SpaceLintDiagnostic[]> {
  const names =
    pages ??
    (await deps.listPageNames())
      .filter((name) => !name.startsWith("Library/"))
      .sort((a, b) => a.localeCompare(b));
  const result: SpaceLintDiagnostic[] = [];
  for (const name of names) {
    const found = await lintPage(deps, name);
    found.sort((a, b) => a.from - b.from);
    result.push(...found.map((f) => f.diagnostic));
  }
  return result;
}
