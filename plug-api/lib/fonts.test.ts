import { expect, test } from "vitest";
import vectors from "./font_value_vectors.json" with { type: "json" };
import {
  BUILTIN_FONTS,
  type FontEntry,
  fontSelectionFor,
  fontStylesheet,
  isSafeFontValue,
  parseFontValue,
  resolveFamily,
} from "./fonts.ts";

const available = {
  "ia-writer-mono": {
    name: "iA Writer Mono",
    family: "'iA-Mono', Menlo, monospace",
    kind: "mono",
  },
  inter: {
    name: "Inter",
    family: "Inter, system-ui, sans-serif",
    kind: "sans",
  },
  "jetbrains-mono": {
    name: "JetBrains Mono",
    family: "'JetBrains Mono', monospace",
    kind: "mono",
    faces: [
      {
        src: "Library/Fonts/JetBrains Mono/JetBrainsMono-Regular.woff2",
        weight: 400,
      },
    ],
  },
} satisfies Record<string, FontEntry>;

test("a known key resolves to its family", () => {
  expect(resolveFamily(["inter"], available)).toBe(
    "Inter, system-ui, sans-serif",
  );
});

test("a plain CSS stack passes through", () => {
  expect(resolveFamily(["Georgia, serif"], available)).toBe("Georgia, serif");
});

test("a removed font falls back to the default", () => {
  expect(resolveFamily(["uninstalled-font"], available)).toBe(
    "'iA-Mono', Menlo, monospace",
  );
});

test("CSS injection is refused", () => {
  expect(resolveFamily(["x; } body { display:none"], available)).toBe(
    "'iA-Mono', Menlo, monospace",
  );
});

test("the default survives a font list without it", () => {
  expect(resolveFamily(["missing"], {})).toBe("'iA-Mono', Menlo, monospace");
});

test("faces become encoded @font-face rules, once per font", () => {
  const css = fontStylesheet(
    {
      ui: ["jetbrains-mono"],
      editor: ["inter"],
      code: ["jetbrains-mono"],
      available,
    },
    "/",
  );
  expect(css.match(/@font-face/g)).toHaveLength(1);
  expect(css).toContain(
    'url("/.fs/Library/Fonts/JetBrains%20Mono/JetBrainsMono-Regular.woff2")',
  );
  expect(css).toContain("--editor-font:Inter, system-ui, sans-serif");
  expect(css).toContain("--editor-monospace-font:'JetBrains Mono', monospace");
});

test("a missing font falls back to the slot's own default", () => {
  expect(resolveFamily(["uninstalled-font", "inter"], available)).toBe(
    "Inter, system-ui, sans-serif",
  );
});

test("library entries that can't be used safely are ignored", () => {
  const broken = {
    ...available,
    injected: { name: "Bad", family: "x; } body { display:none", kind: "sans" },
    unbalanced: { name: "Bad", family: "'Broken, serif", kind: "serif" },
    nofamily: { name: "Bad", kind: "sans" },
  } as unknown as Record<string, FontEntry>;
  for (const key of ["injected", "unbalanced", "nofamily", "constructor"]) {
    expect(resolveFamily([key], broken)).toBe("'iA-Mono', Menlo, monospace");
  }
});

test("malformed faces are skipped rather than breaking the stylesheet", () => {
  const odd = {
    objectFaces: {
      name: "Odd",
      family: "Odd, serif",
      kind: "serif",
      faces: { src: "Library/Odd/Odd.woff2" },
    },
    numberSrc: {
      name: "Odd",
      family: "Odder, serif",
      kind: "serif",
      faces: [{ src: 42 }],
    },
  } as unknown as Record<string, FontEntry>;
  const css = fontStylesheet(
    {
      ui: ["objectFaces"],
      editor: ["numberSrc"],
      code: ["objectFaces"],
      available: odd,
    },
    "/",
  );
  expect(css).not.toContain("@font-face");
  expect(css).toContain("--editor-font:Odder, serif");
});

test("the editor size becomes --editor-font-size, in pixels", () => {
  const css = fontStylesheet(
    { ...fontSelectionFor({ editorSize: 21 }), available },
    "/",
  );
  expect(css).toContain("--editor-font-size:21px");
});

test("an editor size out of range or not a number is left out", () => {
  // Config keeps a value even when its schema check fails, and the sheet
  // must never carry text a CONFIG could inject.
  for (const editorSize of [
    0,
    9,
    49,
    1e9,
    Number.NaN,
    "20px;}html{x:1" as any,
  ]) {
    const css = fontStylesheet(
      { ...fontSelectionFor({ editorSize }), available },
      "/",
    );
    expect(css, String(editorSize)).not.toContain("--editor-font-size");
  }
});

test("a selection falls back to the global default, never for code", () => {
  expect(fontSelectionFor({ editor: "inter" }, "system-serif")).toEqual({
    ui: ["system-serif"],
    editor: ["inter", "system-serif"],
    code: [],
    editorSize: undefined,
    available: {},
  });
});

test("the font value check agrees with the server's, value for value", () => {
  for (const value of vectors.safe)
    expect(isSafeFontValue(value), value).toBe(true);
  for (const value of vectors.unsafe)
    expect(isSafeFontValue(value), value).toBe(false);
  expect(isSafeFontValue("a".repeat(200))).toBe(true);
  expect(isSafeFontValue("a".repeat(201))).toBe(false);
});

test("a font value is a font, a CSS stack, an unknown name, or unsafe", () => {
  expect(parseFontValue("inter", available)).toEqual({
    type: "font",
    entry: available.inter,
  });
  expect(parseFontValue("Georgia, serif", available)).toEqual({
    type: "stack",
    stack: "Georgia, serif",
  });
  expect(parseFontValue("lora", available)).toEqual({ type: "unknown" });
  expect(parseFontValue("constructor", available)).toEqual({
    type: "unknown",
  });
  expect(parseFontValue("x; } body {", available)).toEqual({
    type: "unsafe",
  });
});

test("a fallback font's own files load when the slot falls back to it", () => {
  const lora: FontEntry = {
    name: "Lora",
    family: "Lora, Georgia, serif",
    kind: "serif",
    faces: [{ src: "Library/Fonts/Lora/Lora.ttf", weight: 400 }],
  };
  const css = fontStylesheet(
    fontSelectionFor(
      { ui: "inter", editor: "uninstalled", available: { ...available, lora } },
      "lora",
    ),
    "/",
  );
  expect(css).toContain("--editor-font:Lora, Georgia, serif");
  expect(css).toContain('url("/.fs/Library/Fonts/Lora/Lora.ttf")');
});
