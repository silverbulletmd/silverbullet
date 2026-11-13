import { expect, test } from "vitest";
import vectors from "./font_value_vectors.json" with { type: "json" };
import {
  BUILTIN_FONTS,
  clampXHeight,
  defaultFontLabel,
  type FontEntry,
  fontSelectionFor,
  fontStylesheet,
  isSafeFontValue,
  PROPORTIONAL_COLUMN,
  parseFontValue,
  resolveFamily,
  UI_FONT,
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

test("a proportional editor font narrows the source column; a monospace one keeps 1ch", () => {
  const sel = (editor: string) =>
    fontStylesheet(
      { ui: ["inter"], editor: [editor], code: ["jetbrains-mono"], available },
      "/",
    );
  expect(sel("inter")).toContain(
    `--editor-column-width:${PROPORTIONAL_COLUMN}`,
  );
  expect(sel("jetbrains-mono")).not.toContain("--editor-column-width");
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

test("a measured x-height becomes --editor-font-x-height", () => {
  const sel = { ...fontSelectionFor({ editor: "inter" }), available };
  expect(fontStylesheet(sel, "/", 0.4012)).toContain(
    "--editor-font-x-height:0.401",
  );
  expect(fontStylesheet(sel, "/")).not.toContain("--editor-font-x-height");
  expect(fontStylesheet(sel, "/", "1;}html{x:1" as any)).not.toContain(
    "--editor-font-x-height",
  );
});

test("an x-height is clamped to a sane range, and a failed one is dropped", () => {
  expect(clampXHeight(0.4)).toBe(0.4);
  expect(clampXHeight(0.1)).toBe(0.3);
  expect(clampXHeight(0.95)).toBe(0.7);
  for (const failed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(clampXHeight(failed), String(failed)).toBeUndefined();
  }
});

test("a selection holds the space's own fonts", () => {
  expect(fontSelectionFor({ editor: "inter" })).toEqual({
    ui: ["inter"],
    editor: ["inter"],
    code: [],
    editorSize: undefined,
    available: BUILTIN_FONTS,
  });
});

test("the font value check accepts the safe vectors and rejects the unsafe ones", () => {
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
      { editor: "lora" },
    ),
    "/",
  );
  expect(css).toContain("--editor-font:Lora, Georgia, serif");
  expect(css).toContain('url("/.fs/Library/Fonts/Lora/Lora.ttf")');
});

test("a theme's suggestion fills a slot the space leaves unset", () => {
  const theme = { ui: "system-sans", editor: "inter", code: "system-mono" };
  expect(fontSelectionFor({}, theme)).toMatchObject({
    ui: ["system-sans", "inter"],
    editor: ["inter"],
    code: ["system-mono"],
  });
});

test("the interface font is the theme's, whatever the space says", () => {
  expect(fontSelectionFor({ ui: "lora" }, { ui: "system-mono" }).ui).toEqual([
    "system-mono",
    UI_FONT,
  ]);
  expect(fontSelectionFor({ ui: "lora" }).ui).toEqual([UI_FONT]);
});

test("the space's own font beats the theme's suggestion", () => {
  const sel = fontSelectionFor(
    { editor: "jetbrains-mono", code: "inter" },
    { editor: "inter", code: "system-mono" },
  );
  expect(sel.editor).toEqual(["jetbrains-mono", "inter"]);
  expect(sel.code).toEqual(["inter", "system-mono"]);
});

test("a suggestion naming a missing font falls through to the built-in default", () => {
  const sel = fontSelectionFor({ available }, { editor: "nonexistent" });
  expect(resolveFamily(sel.editor, available)).toBe(
    "'iA-Mono', Menlo, monospace",
  );
});

test("the theme's editor size applies only when the space sets none", () => {
  expect(fontSelectionFor({}, { editorSize: 20 }).editorSize).toBe(20);
  expect(
    fontSelectionFor({ editorSize: 16 }, { editorSize: 20 }).editorSize,
  ).toBe(16);
});

test("with nothing set, code is iA Writer Mono and the size is the theme's", () => {
  const sel = fontSelectionFor({ available });
  expect(resolveFamily(sel.code, available)).toBe(
    "'iA-Mono', Menlo, monospace",
  );
  expect(sel.editorSize).toBeUndefined();
});

const ink = { displayName: "Ink", fonts: { editor: "inter", code: "nope" } };

test("the default label names a usable theme suggestion", () => {
  expect(defaultFontLabel(available, "editor", ink)).toBe(
    "Default (Inter, suggested by Ink)",
  );
});

test("an unusable suggestion is not shown", () => {
  expect(defaultFontLabel(available, "code", ink)).toBe(
    "Default (iA Writer Mono)",
  );
});

test("with nothing set the label is the built-in default", () => {
  expect(defaultFontLabel({}, "editor", undefined)).toBe(
    "Default (iA Writer Mono)",
  );
});
