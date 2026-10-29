import { describe, expect, test, vi } from "vitest";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import {
  type LintPagesDeps,
  type LintProgress,
  lintPages,
  offsetToLineColumn,
} from "./space_lint.ts";

function meta(name: string): PageMeta {
  return {
    ref: name,
    tag: "page",
    name,
    created: "",
    lastModified: "",
    perm: "rw",
  } as PageMeta;
}

const yamlError: LintPagesDeps["dispatchLint"] = async (event) =>
  event.text.startsWith("---")
    ? [
        {
          listener: "index.lintYAML",
          diagnostics: [
            {
              from: 8,
              to: 10,
              severity: "error",
              message: "bad yaml",
              source: "yaml",
            },
          ],
        },
      ]
    : [];

function fakeDeps(
  pages: Record<string, string>,
  overrides: Partial<LintPagesDeps> = {},
): LintPagesDeps {
  return {
    listPageNames: async () => Object.keys(pages),
    readPage: async (name) => {
      if (!(name in pages)) throw new Error("Not found");
      return { text: pages[name], meta: meta(name) };
    },
    dispatchLint: async () => [],
    renderDirective: async () => "ok",
    luaCodeWidget: () => undefined,
    ...overrides,
  };
}

describe("offsetToLineColumn", () => {
  test("maps offsets to 1-based line and column", () => {
    const text = "ab\ncde\n\nf";
    expect(offsetToLineColumn(text, 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn(text, 1)).toEqual({ line: 1, column: 2 });
    expect(offsetToLineColumn(text, 3)).toEqual({ line: 2, column: 1 });
    expect(offsetToLineColumn(text, 5)).toEqual({ line: 2, column: 3 });
    expect(offsetToLineColumn(text, 7)).toEqual({ line: 3, column: 1 });
    expect(offsetToLineColumn(text, 8)).toEqual({ line: 4, column: 1 });
  });

  test("clamps offsets past the end", () => {
    expect(offsetToLineColumn("ab", 99)).toEqual({ line: 1, column: 3 });
  });
});

describe("lintPages", () => {
  test("reports unresolved merge conflict markers", async () => {
    const text =
      "Intro\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\nEnd\n";
    const found = await lintPages(fakeDeps({ Notes: text, Clean: "fine\n" }), [
      "Notes",
      "Clean",
    ]);
    expect(found).toEqual([
      {
        page: "Notes",
        line: 2,
        column: 1,
        severity: "error",
        message: "Unresolved merge conflict",
        source: "conflict",
      },
    ]);
  });

  test("collects listener diagnostics with page, position and source, leaving out hints", async () => {
    const text = "---\nfoo: [\n---\nHello\n";
    const events: any[] = [];
    const deps = fakeDeps(
      { Notes: text },
      {
        dispatchLint: async (event) => {
          events.push(event);
          return [
            {
              listener: "index.lintYAML",
              diagnostics: [
                {
                  from: 8,
                  to: 10,
                  severity: "error",
                  message: "bad yaml",
                  source: "yaml",
                },
              ],
            },
            {
              listener: "index.xrayInfo",
              diagnostics: [
                { from: 0, to: 1, severity: "hint", message: "object" },
              ],
            },
          ];
        },
      },
    );
    expect(await lintPages(deps, ["Notes"])).toEqual([
      {
        page: "Notes",
        line: 2,
        column: 5,
        severity: "error",
        message: "bad yaml",
        source: "yaml",
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("Notes");
    expect(events[0].text).toBe(text);
    expect(events[0].pageMeta.name).toBe("Notes");
    expect(events[0].tree.type).toBe("Document");
  });

  test("a diagnostic without its own source is attributed to its listener", async () => {
    const deps = fakeDeps(
      { Notes: "Hello\n" },
      {
        dispatchLint: async () => [
          {
            listener: "other.checkThings",
            diagnostics: [
              { from: 0, to: 1, severity: "warning", message: "plug" },
            ],
          },
          {
            diagnostics: [
              { from: 1, to: 2, severity: "info", message: "space lua" },
            ],
          },
        ],
      },
    );
    expect(
      (await lintPages(deps, ["Notes"])).map((d) => [d.message, d.source]),
    ).toEqual([
      ["plug", "other.checkThings"],
      ["space lua", "listener"],
    ]);
  });

  test("reports failing ${...} directives as widget diagnostics", async () => {
    const text = "Intro\n\nValue: ${undefinedFn()} and ${1 + 1}\n";
    const rendered: string[] = [];
    const deps = fakeDeps(
      { Notes: text },
      {
        renderDirective: async (expr, pageMeta) => {
          rendered.push(`${pageMeta.name}:${expr}`);
          return expr === "undefinedFn()"
            ? "**Lua error:** Attempting to call nil (Origin: [[Notes@15]])"
            : 2;
        },
      },
    );
    expect(await lintPages(deps, ["Notes"])).toEqual([
      {
        page: "Notes",
        line: 3,
        column: 8,
        severity: "error",
        message: "Lua error: Attempting to call nil (Origin: [[Notes@15]])",
        source: "widget",
      },
    ]);
    expect(rendered).toEqual(["Notes:undefinedFn()", "Notes:1 + 1"]);
  });

  test("a directive that throws (e.g. does not parse) is a widget diagnostic", async () => {
    const deps = fakeDeps(
      { Notes: "${1 +}" },
      {
        renderDirective: async () => {
          throw new Error("Parse error at pos 3");
        },
      },
    );
    expect(await lintPages(deps, ["Notes"])).toEqual([
      {
        page: "Notes",
        line: 1,
        column: 1,
        severity: "error",
        message: "Parse error at pos 3",
        source: "widget",
      },
    ]);
  });

  test("timeouts and errors from Lua code widgets are reported too", async () => {
    const text = "# Title\n```chart\ndata\n```\n```other\nx\n```\n";
    const calls: string[] = [];
    const deps = fakeDeps(
      { Notes: text },
      {
        luaCodeWidget: (lang) =>
          lang === "chart"
            ? async (body, pageMeta) => {
                calls.push(`${pageMeta.name}:${body}`);
                return "**Lua timeout:** this widget took too long to render and was stopped. Reload the page to try again.";
              }
            : undefined,
      },
    );
    const result = await lintPages(deps, ["Notes"]);
    expect(calls).toEqual(["Notes:data"]);
    expect(result).toEqual([
      {
        page: "Notes",
        line: 2,
        column: 1,
        severity: "error",
        message:
          "Lua timeout: this widget took too long to render and was stopped. Reload the page to try again.",
        source: "widget",
      },
    ]);
  });

  test("without pages, lints all pages including libraries and repositories, sorted by page then position", async () => {
    const deps = fakeDeps(
      {
        "Library/Std/Thing": "${boom()}",
        "Repositories/Example/Readme": "${boom()}",
        b: "x\n${boom()}",
        a: "${boom()} ${boom()}",
      },
      { renderDirective: async () => "**Lua error:** boom" },
    );
    const result = await lintPages(deps);
    expect(result.map((d) => `${d.page}:${d.line}:${d.column}`)).toEqual([
      "a:1:1",
      "a:1:11",
      "b:2:1",
      "Library/Std/Thing:1:1",
      "Repositories/Example/Readme:1:1",
    ]);
  });

  test("a page that cannot be read is reported rather than aborting the run", async () => {
    const deps = fakeDeps({ a: "fine" });
    expect(await lintPages(deps, ["missing", "a"])).toEqual([
      {
        page: "missing",
        line: 1,
        column: 1,
        severity: "error",
        message: "Could not read page: Not found",
        source: "page",
      },
    ]);
  });

  test("reports progress after each page with that page's findings", async () => {
    const deps = fakeDeps(
      { A: "Hello\n", B: "---\nfoo: [\n---\nHi\n" },
      { dispatchLint: yamlError },
    );
    const progress: LintProgress[] = [];
    await lintPages(deps, ["A", "B"], {
      onProgress: (p) => progress.push(p),
    });
    expect(progress).toHaveLength(2);
    expect(progress[0]).toEqual({ done: 1, total: 2, page: "A", found: [] });
    expect(progress[1]).toMatchObject({ done: 2, total: 2, page: "B" });
    expect(progress[1].found).toHaveLength(1);
    expect(progress[1].found[0].page).toBe("B");
  });

  test("stops before the next page once aborted and returns findings so far", async () => {
    const readPage = vi.fn(async (name: string) => ({
      text: "---\nfoo: [\n---\n",
      meta: meta(name),
    }));
    const deps = fakeDeps({}, { readPage, dispatchLint: yamlError });
    const controller = new AbortController();
    const result = await lintPages(deps, ["A", "B"], {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(result.every((d) => d.page === "A")).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
