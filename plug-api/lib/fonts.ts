/** The fonts a theme suggests (its `fonts` frontmatter). */
export type ThemeFonts = {
  ui?: string;
  editor?: string;
  code?: string;
  editorSize?: number;
};

/** One file of a font family, as a space path. */
export type FontFaceSpec = { src: string; weight?: number; style?: string };

/** An entry of `fonts.available`, registered by Std or a font library. */
export type FontEntry = {
  name: string;
  family: string;
  kind: "sans" | "serif" | "mono";
  faces?: FontFaceSpec[];
  license?: string;
};

/** The `fonts` config as a space sets it: every part optional. */
export type FontsConfig = {
  /** No longer used: a space doesn't pick the interface font; its theme does. */
  ui?: string;
  editor?: string;
  code?: string;
  editorSize?: number;
  available?: Record<string, FontEntry>;
};

/**
 * What each slot shows: the values to try in order (the space's setting,
 * then whatever stands in for it), each a `fonts.available` key or a CSS
 * stack. The built-in default font comes after the last.
 */
export type FontSelection = {
  ui: string[];
  editor: string[];
  code: string[];
  /** Page text size in the editor, in pixels; unset keeps the theme's. */
  editorSize?: number;
  available: Record<string, FontEntry>;
};

/** The editor sizes `fonts.editorSize` allows (Std's schema says the same). */
export const EDITOR_SIZE_RANGE = { min: 10, max: 48 };

function isEditorSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    value >= EDITOR_SIZE_RANGE.min &&
    value <= EDITOR_SIZE_RANGE.max
  );
}

/**
 * What a space's `fonts` config selects. The interface font is the theme's
 * (its `ui` suggestion, else {@link UI_FONT}); a space's `fonts.ui` is
 * ignored. For the editor and code, the active theme's suggestion
 * (`themeFonts`) fills a slot the space doesn't set; the built-in default font
 * stands in for one neither sets.
 */
export function fontSelectionFor(
  fonts: FontsConfig,
  themeFonts?: ThemeFonts,
): FontSelection {
  const chain = (...values: (string | undefined)[]) =>
    values.filter((value): value is string => !!value);
  return {
    ui: chain(themeFonts?.ui, UI_FONT),
    editor: chain(fonts.editor, themeFonts?.editor),
    code: chain(fonts.code, themeFonts?.code),
    editorSize: fonts.editorSize ?? themeFonts?.editorSize,
    // The bundled fonts are always there, so the interface font and a
    // built-in theme's suggestion resolve before Std's config is indexed.
    available: { ...BUILTIN_FONTS, ...fonts.available },
  };
}

export const DEFAULT_FONT = "ia-writer-mono";

/** The interface font when the theme suggests none. */
export const UI_FONT = "inter";

/**
 * Whether a font value can go into a `<style>` element: names, spaces,
 * commas and hyphens, with quotes in pairs, so nothing can end the
 * declaration or open a string that swallows the rest of the sheet. Tested
 * against `font_value_vectors.json`.
 */
export function isSafeFontValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    [...value].length <= 200 && // characters, as the server counts them
    /^[\p{L}\p{N}_ ,'"-]+$/u.test(value) &&
    (value.match(/'/g)?.length ?? 0) % 2 === 0 &&
    (value.match(/"/g)?.length ?? 0) % 2 === 0
  );
}

/**
 * An entry fit to use. `fonts.available` is filled by libraries, and config
 * keeps a value even when its schema check fails, so nothing about an entry
 * is assumed.
 */
export function usableEntry(
  available: Record<string, FontEntry>,
  key: string,
): FontEntry | undefined {
  if (!Object.hasOwn(available, key)) return undefined;
  const entry = available[key];
  return entry && isSafeFontValue(entry.family) ? entry : undefined;
}

/** What a font setting's value is. */
export type FontValue =
  /** The key of a usable `fonts.available` entry. */
  | { type: "font"; entry: FontEntry }
  /** A CSS font-family list, used as written. */
  | { type: "stack"; stack: string }
  /** A bare word naming no font: an uninstalled or not yet indexed one. */
  | { type: "unknown" }
  /** Nothing that can go into a stylesheet. */
  | { type: "unsafe" };

/**
 * A key wins over a stack. A bare word is a key, never a family name: a
 * single family without a fallback is far more likely an uninstalled font
 * library's key than a font the system has.
 */
export function parseFontValue(
  value: string,
  available: Record<string, FontEntry>,
): FontValue {
  const entry = usableEntry(available, value);
  if (entry) return { type: "font", entry };
  if (!isSafeFontValue(value)) return { type: "unsafe" };
  if (/[\s,'"]/.test(value)) return { type: "stack", stack: value };
  return { type: "unknown" };
}

/** A slot's font: the first usable value in its chain, else the default. */
function resolveSlot(
  chain: string[],
  available: Record<string, FontEntry>,
): { family: string; entry?: FontEntry } {
  for (const value of chain) {
    const parsed = parseFontValue(value, available);
    if (parsed.type === "font") {
      return { family: parsed.entry.family, entry: parsed.entry };
    }
    if (parsed.type === "stack") return { family: parsed.stack };
  }
  const entry =
    usableEntry(available, DEFAULT_FONT) ?? BUILTIN_FONTS[DEFAULT_FONT];
  return { family: entry.family, entry };
}

/** The CSS font-family a slot with this chain shows. */
export function resolveFamily(
  chain: string[],
  available: Record<string, FontEntry>,
): string {
  return resolveSlot(chain, available).family;
}

const FORMATS: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
};

function faceRule(family: string, face: FontFaceSpec, fsBase: string): string {
  const path = face.src.split("/").map(encodeURIComponent).join("/");
  const ext = face.src.split(".").pop()?.toLowerCase() ?? "";
  const format = FORMATS[ext] ? ` format("${FORMATS[ext]}")` : "";
  const weight = Number.isFinite(face.weight) ? face.weight : 400;
  const style = face.style === "italic" ? "italic" : "normal";
  return `@font-face{font-family:"${family}";src:url("${fsBase}.fs/${path}")${format};font-weight:${weight};font-style:${style};font-display:swap}`;
}

/** The family name a font's own faces declare: the first of its stack. */
function primaryFamily(stack: string): string {
  return stack
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/** One source column with a proportional editor font, as `--editor-column-width`. */
export const PROPORTIONAL_COLUMN = "0.75ch";

/** The x-height ratios `--editor-font-x-height` allows. */
const X_HEIGHT_RANGE = { min: 0.3, max: 0.7 };

/**
 * A measured x-height (as a fraction of the font size) fit to use: clamped,
 * or undefined when the measurement failed.
 */
export function clampXHeight(ratio: unknown): number | undefined {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) {
    return undefined;
  }
  return Math.min(X_HEIGHT_RANGE.max, Math.max(X_HEIGHT_RANGE.min, ratio));
}

/**
 * The CSS variables the font stylesheet sets. A theme setting one would
 * override the space's font choice, which the lint warns about.
 */
export const FONT_VARIABLES = {
  ui: "--ui-font",
  editor: "--editor-font",
  code: "--editor-monospace-font",
  editorSize: "--editor-font-size",
  xHeight: "--editor-font-x-height",
  column: "--editor-column-width",
} as const;

/**
 * The stylesheet for a selection: `@font-face` rules for the faces of the
 * fonts the slots show only (browsers fetch a face when text first uses it),
 * then the CSS variables every surface reads. `editorXHeight` is the editor
 * font's measured x-height, which code is scaled to match.
 */
export function fontStylesheet(
  sel: FontSelection,
  fsBase: string,
  editorXHeight?: number,
): string {
  const slots = [sel.ui, sel.editor, sel.code].map((chain) =>
    resolveSlot(chain, sel.available),
  );
  const rules: string[] = [];
  for (const entry of new Set(slots.map((slot) => slot.entry))) {
    if (!entry || !Array.isArray(entry.faces)) continue;
    const family = primaryFamily(entry.family);
    for (const face of entry.faces) {
      if (typeof face?.src === "string") {
        rules.push(faceRule(family, face, fsBase));
      }
    }
  }
  const [ui, editor, code] = slots.map((slot) => slot.family);
  // `html`: this beats theme.scss's `:where(html)` defaults. `#sb-fonts` comes
  // before `#sb-theme`, so a theme setting these would beat it (the lint warns
  // about that), and a space-style on `html` (later still) or `:root` does too.
  const ratio = clampXHeight(editorXHeight);
  const vars: [string, string | undefined][] = [
    [FONT_VARIABLES.ui, ui],
    [FONT_VARIABLES.editor, editor],
    [FONT_VARIABLES.code, code],
    [
      FONT_VARIABLES.editorSize,
      isEditorSize(sel.editorSize) ? `${sel.editorSize}px` : undefined,
    ],
    [FONT_VARIABLES.xHeight, ratio?.toFixed(3)],
    // A source column is a `0` wide: exact for monospace, but a proportional
    // `0` is broad, which spreads list and task markers far from their text.
    [
      FONT_VARIABLES.column,
      slots[1].entry && slots[1].entry.kind !== "mono"
        ? PROPORTIONAL_COLUMN
        : undefined,
    ],
  ];
  rules.push(
    `html{${vars
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}:${value}`)
      .join(";")}}`,
  );
  return rules.join("\n");
}

export const FONT_STYLE_ID = "sb-fonts";

export function baseOf(doc: Document): string {
  return doc.baseURI.replace(/\/*$/, "/");
}

/** Per space, like the boot fetch cache in boot.ts. */
export function fontCacheKey(baseURI: string): string {
  return `silverbullet.${baseURI}.fonts`;
}

/**
 * Fills `#sb-fonts`, which `index.html` declares before the theme and the
 * space's styles: at equal specificity the later sheet wins, so a space-style
 * `--editor-font` override keeps working as documented. A document without
 * one gets it at the end of its head.
 */
export function applyFontStylesheet(css: string, doc = document): void {
  let style = doc.getElementById(FONT_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = FONT_STYLE_ID;
    doc.head.append(style);
  }
  style.textContent = css;
}

/**
 * The x-height of the font `family` shows, measured on a canvas once its
 * faces have loaded (else a fallback would be measured); undefined where the
 * browser can't tell.
 */
export async function measureXHeight(
  family: string,
  doc = document,
): Promise<number | undefined> {
  const font = `100px ${family}`;
  try {
    if (typeof doc.fonts?.load !== "function") return undefined;
    await doc.fonts.load(font);
    const ctx = doc.createElement("canvas").getContext("2d");
    if (!ctx) return undefined;
    ctx.font = font;
    return clampXHeight(ctx.measureText("x").actualBoundingBoxAscent / 100);
  } catch {
    return undefined;
  }
}

const X_HEIGHT_CACHE_KEY = "silverbullet.fontXHeights";

function rememberedXHeights(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(X_HEIGHT_CACHE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function rememberXHeight(key: string, ratio: number): void {
  try {
    localStorage.setItem(
      X_HEIGHT_CACHE_KEY,
      JSON.stringify({ ...rememberedXHeights(), [key]: ratio }),
    );
  } catch {
    // No storage: measured again on every load, after a first paint without.
  }
}

const installs = new WeakMap<Document, number>();

/**
 * Installs a selection's stylesheet (and caches it under `cacheKey`), then
 * measures the editor font and installs it again if its x-height differs
 * from the one remembered, unless another selection was installed meanwhile.
 */
export function installFonts(
  sel: FontSelection,
  { doc = document, cacheKey }: { doc?: Document; cacheKey?: string } = {},
): void {
  const family = resolveFamily(sel.editor, sel.available);
  // Per space: the same family name can be another space's library font
  const xHeightKey = `${fontCacheKey(doc.baseURI)}:${family}`;
  const install = (xHeight: number | undefined) => {
    const css = fontStylesheet(sel, baseOf(doc), xHeight);
    applyFontStylesheet(css, doc);
    if (!cacheKey) return;
    try {
      localStorage.setItem(cacheKey, css);
    } catch {
      // Private mode or blocked storage: fonts still apply, just not cached.
    }
  };
  const remembered = clampXHeight(rememberedXHeights()[xHeightKey]);
  install(remembered);
  const id = (installs.get(doc) ?? 0) + 1;
  installs.set(doc, id);
  void measureXHeight(family, doc).then((measured) => {
    if (measured === undefined) return;
    rememberXHeight(xHeightKey, measured);
    if (installs.get(doc) === id && measured !== remembered) install(measured);
  });
}

/**
 * Applies the space's font settings (see `fontSelectionFor`). Call it only
 * once the space's config is loaded: before that every chain is empty, so it
 * would replace the cached fonts, and the cache, by the default font. With
 * `cache` off (a theme preview) the fonts show but the next boot doesn't
 * start from them. Until `indexReady`, library fonts may not be registered
 * yet, so a choice that names no known font keeps the fonts already showing
 * (from the cache) rather than replacing them, and the cache with them, by a
 * fallback.
 */
export function applyFonts(
  fonts: FontsConfig,
  {
    indexReady = true,
    doc = document,
    themeFonts,
    cache = true,
  }: {
    indexReady?: boolean;
    doc?: Document;
    themeFonts?: ThemeFonts;
    cache?: boolean;
  } = {},
): void {
  const sel = fontSelectionFor(fonts, themeFonts);
  const pending = [...sel.ui, ...sel.editor, ...sel.code].some(
    (value) => parseFontValue(value, sel.available).type === "unknown",
  );
  if (pending && !indexReady) {
    if (!doc.getElementById(FONT_STYLE_ID)) installFonts(sel, { doc });
    return;
  }
  installFonts(sel, {
    doc,
    cacheKey: cache ? fontCacheKey(doc.baseURI) : undefined,
  });
}

/**
 * Applies the fonts from the last run before config exists. A font added by
 * a library page isn't known until that page is indexed, which on a fresh
 * device would otherwise flash the default font first.
 */
export function applyCachedFonts(doc = document): void {
  try {
    const css = localStorage.getItem(fontCacheKey(doc.baseURI));
    if (css) applyFontStylesheet(css, doc);
  } catch {
    // No storage: the default fonts show until config loads.
  }
}

/**
 * The fonts Std registers, so the default font is there before a space's
 * config registers it. A test keeps this in step with Std.
 */
export const BUILTIN_FONTS: Record<string, FontEntry> = {
  "ia-writer-mono": {
    name: "iA Writer Mono",
    family: "'iA-Mono', Menlo, monospace",
    kind: "mono",
    license: "OFL-1.1",
  },
  inter: {
    name: "Inter",
    family: "Inter, system-ui, sans-serif",
    kind: "sans",
    license: "OFL-1.1",
  },
  lora: {
    name: "Lora",
    family: "Lora, Georgia, serif",
    kind: "serif",
    license: "OFL-1.1",
  },
  "system-sans": {
    name: "System sans",
    family: "system-ui, sans-serif",
    kind: "sans",
  },
  "system-serif": {
    name: "System serif",
    family: "ui-serif, Georgia, serif",
    kind: "serif",
  },
  "system-mono": {
    name: "System mono",
    family: "ui-monospace, Menlo, monospace",
    kind: "mono",
  },
};

/**
 * What an unset font setting shows in Configuration: "Default (EB Garamond,
 * suggested by Ink)", or "Default (iA Writer Mono)" when nothing is
 * suggested or the suggestion can't be used.
 */
export function defaultFontLabel(
  available: Record<string, FontEntry>,
  slot: "editor" | "code",
  theme: { displayName: string; fonts?: ThemeFonts } | undefined,
): string {
  const nameOf = (value: string | undefined) => {
    if (!value) return undefined;
    const parsed = parseFontValue(value, available);
    if (parsed.type === "font") return parsed.entry.name;
    return parsed.type === "stack" ? parsed.stack : undefined;
  };
  const suggested = nameOf(theme?.fonts?.[slot]);
  if (suggested) {
    return `Default (${suggested}, suggested by ${theme?.displayName})`;
  }
  const name =
    usableEntry(available, DEFAULT_FONT)?.name ??
    BUILTIN_FONTS[DEFAULT_FONT].name;
  return `Default (${name})`;
}
