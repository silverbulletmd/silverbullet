import { describe, expect, it } from "vitest";
import { bootBlocks, collectTooling, type ToolingFile } from "./tooling.ts";

const f = (path: string, text: string): ToolingFile => ({
  path,
  lastModified: 1,
  text,
});
const lua = (code: string) => "```space-lua\n" + code + "\n```\n";

describe("collectTooling", () => {
  it("only takes blocks from Tool Pages", () => {
    const { scripts } = collectTooling([
      f("Notes.md", lua("a=1")),
      f("CONFIG.md", lua("legacy=1")),
      f("Library/A.md", lua("b=1")),
    ]);
    expect(scripts.map((s) => s.page)).toEqual(["Library/A"]);
  });

  it("skips commented-out blocks", () => {
    const { scripts } = collectTooling([
      f("Library/Config.md", "<!--\n" + lua("x=1") + "-->\n"),
    ]);
    expect(scripts).toEqual([]);
  });

  it("orders by priority (missing = 0), then page, then numeric position", () => {
    const pad = "x".repeat(990) + "\n";
    const { scripts } = collectTooling([
      f("Library/B.md", lua("b=1")),
      f("Library/A.md", lua("a1=1") + pad + lua("a2=1")),
      f("Library/Z.md", lua("-- priority: 10\nz=1")),
      f("Library/N.md", lua("-- priority: -1\nn=1")),
    ]);
    expect(scripts.map((s) => s.code.split("\n").at(-1))).toEqual([
      "z=1",
      "a1=1",
      "a2=1",
      "b=1",
      "n=1",
    ]);
  });

  it("compares positions as numbers, not strings", () => {
    const text =
      "x".repeat(199) +
      "\n" +
      lua("first=1") +
      "x".repeat(1000) +
      "\n" +
      lua("second=1");
    const { scripts } = collectTooling([f("Library/A.md", text)]);
    expect(scripts.map((s) => s.pos)).toEqual([200, expect.any(Number)]);
    expect(scripts[1].pos).toBeGreaterThanOrEqual(1000);
    expect(scripts.map((s) => s.code.split("\n").at(-1))).toEqual([
      "first=1",
      "second=1",
    ]);
  });

  it("treats styles with no priority as 0", () => {
    const css = (c: string) => "```space-style\n" + c + "\n```\n";
    const { styles } = collectTooling([
      f("Library/A.md", css("a{}")),
      f("Library/B.md", css("/* priority: 5 */\nb{}")),
    ]);
    expect(styles.map((s) => s.page)).toEqual(["Library/B", "Library/A"]);
  });
});

describe("boot marker", () => {
  const bootOf = (page: string, code: string) =>
    collectTooling([f(`${page}.md`, lua(code))]).scripts[0].boot;

  it("marks blocks with a -- boot: true line", () => {
    expect(bootOf("Library/A", "-- boot: true\nx=1")).toBe(true);
    expect(bootOf("Library/A", "x=1\n  --boot:true\ny=2")).toBe(true);
    expect(bootOf("Library/A", "-- boot:  true \nx=1")).toBe(true);
  });

  it("treats every Library/Config block as a boot block", () => {
    expect(bootOf("Library/Config", "x=1")).toBe(true);
  });

  it("leaves other blocks alone", () => {
    for (const marker of [
      "-- boot",
      "-- boot: false",
      "-- boot: yes",
      "-- booted: true",
      "--boot-strap",
    ]) {
      expect(bootOf("Library/A", `${marker}\nx=1`)).toBe(false);
    }
    expect(bootOf("Library/A", "x=1")).toBe(false);
  });
});

describe("bootBlocks", () => {
  it("returns only boot blocks, in tooling order", () => {
    const { scripts } = collectTooling([
      f("Library/B.md", lua("-- boot: true\nb=1")),
      f("Library/A.md", lua("a=1")),
      f("Library/C.md", lua("-- boot: true\n-- priority: 5\nc=1")),
      f("Library/Config.md", lua("cfg=1")),
    ]);
    expect(bootBlocks(scripts).map((b) => b.page)).toEqual([
      "Library/C",
      "Library/B",
      "Library/Config",
    ]);
  });
});

describe("theme pages", () => {
  const css = (c: string) => "```space-style\n" + c + "\n```\n";
  const themeFm = "---\ntags: meta/theme\nscheme: dark\n---\n";
  const payload = [
    f(
      "Library/T/Night.md",
      themeFm + css("a{}") + css("/* priority: 5 */\nb{}") + lua("night=1"),
    ),
    f("Library/Plain.md", css("plain{}")),
    f(
      "Library/Broken.md",
      "---\ntags: [meta/theme\nscheme: : dark\n---\n" + css("broken{}"),
    ),
  ];

  it("drops the styles of a theme-tagged page without a valid scheme, but runs its scripts", () => {
    const { themes, themeStyles, styles, scripts } = collectTooling([
      f(
        "Library/T/Sepia.md",
        "---\ntags: meta/theme\nscheme: sepia\n---\n" +
          css("red{}") +
          lua("sepia=1"),
      ),
      f("Library/T/NoScheme.md", "---\ntags: meta/theme\n---\n" + css("x{}")),
    ]);
    expect(themes).toEqual([]);
    expect(themeStyles).toEqual([]);
    expect(styles).toEqual([]);
    expect(scripts.map((s) => s.page)).toEqual(["Library/T/Sepia"]);
  });

  it("routes theme page styles to themeStyles", () => {
    const { themes, themeStyles, styles, scripts } = collectTooling(payload);
    expect(themes.map((t) => t.page)).toEqual(["Library/T/Night"]);
    expect(themeStyles.map((b) => b.code.split("\n").at(-1))).toEqual([
      "b{}",
      "a{}",
    ]);
    expect(themeStyles.every((b) => b.page === "Library/T/Night")).toBe(true);
    expect(styles.map((b) => b.page)).toEqual([
      "Library/Broken",
      "Library/Plain",
    ]);
    expect(scripts.map((b) => b.page)).toEqual(["Library/T/Night"]);
  });
});
