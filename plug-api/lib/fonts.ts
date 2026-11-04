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
 * What a space's `fonts` config selects. `globalDefault` (the server- or
 * app-wide default font) stands in for an interface or editor font the
 * space doesn't set, or sets to a font that is gone; the code font has its
 * own default.
 */
export function fontSelectionFor(
  fonts: FontsConfig,
  globalDefault?: string,
): FontSelection {
  const chain = (...values: (string | undefined)[]) =>
    values.filter((value): value is string => !!value);
  return {
    ui: chain(fonts.ui, globalDefault),
    editor: chain(fonts.editor, globalDefault),
    code: chain(fonts.code),
    editorSize: fonts.editorSize,
    available: fonts.available ?? {},
  };
}

export const DEFAULT_FONT = "ia-writer-mono";

/**
 * Whether a font value can go into a `<style>` element: names, spaces,
 * commas and hyphens, with quotes in pairs, so nothing can end the
 * declaration or open a string that swallows the rest of the sheet. The
 * server checks the same rule (`is_safe_font_value`); both test against
 * `font_value_vectors.json`.
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

/**
 * The stylesheet for a selection: `@font-face` rules for the faces of the
 * fonts the slots show only (browsers fetch a face when text first uses it),
 * then the CSS variables every surface reads.
 */
export function fontStylesheet(sel: FontSelection, fsBase: string): string {
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
  // `html`, the selector theme.scss uses: this sheet comes later, so it beats
  // the theme, and a space-style on `html` (later still) or `:root` beats it.
  const size = isEditorSize(sel.editorSize)
    ? `;--editor-font-size:${sel.editorSize}px`
    : "";
  rules.push(
    `html{--ui-font:${ui};--editor-font:${editor};--editor-monospace-font:${code}${size}}`,
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
 * Installs the font stylesheet just before `#custom-styles`: at equal
 * specificity the later sheet wins, so a space-style `--editor-font`
 * override keeps working as documented.
 */
export function applyFontStylesheet(css: string, doc = document): void {
  let style = doc.getElementById(FONT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = FONT_STYLE_ID;
    const customStyles = doc.getElementById("custom-styles");
    if (customStyles) {
      customStyles.before(style);
    } else {
      doc.head.append(style);
    }
  }
  style.textContent = css;
}

/**
 * Applies the space's font settings (see `fontSelectionFor`). Until
 * `indexReady`, library fonts may not be registered yet, so a choice that
 * names no known font keeps the fonts already showing (from the cache)
 * rather than replacing them, and the cache with them, by a fallback.
 */
export function applyFonts(
  fonts: FontsConfig,
  globalDefault?: string,
  {
    indexReady = true,
    doc = document,
  }: { indexReady?: boolean; doc?: Document } = {},
): void {
  const sel = fontSelectionFor(fonts, globalDefault);
  const pending = [...sel.ui, ...sel.editor, ...sel.code].some(
    (value) => parseFontValue(value, sel.available).type === "unknown",
  );
  if (pending && !indexReady) {
    if (!doc.getElementById(FONT_STYLE_ID)) {
      applyFontStylesheet(fontStylesheet(sel, baseOf(doc)), doc);
    }
    return;
  }
  const css = fontStylesheet(sel, baseOf(doc));
  applyFontStylesheet(css, doc);
  try {
    localStorage.setItem(fontCacheKey(doc.baseURI), css);
  } catch {
    // Private mode or blocked storage: fonts still apply, just not cached.
  }
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
 * The fonts Std registers, for pages with no space and so no space config:
 * the dashboard, login and setup. A test keeps this in step with Std.
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

const GLOBAL_FONT_KEY = "silverbullet.defaultFontSheet";

/**
 * Applies the server- or app-wide default font to a page with no space: the
 * same stylesheet a space gets when it sets no fonts of its own, from the
 * built-in fonts, and cached the same way.
 */
export function applyGlobalFont(
  value: string | undefined,
  doc = document,
): void {
  const css = fontStylesheet(
    fontSelectionFor({ available: BUILTIN_FONTS }, value),
    baseOf(doc),
  );
  applyFontStylesheet(css, doc);
  try {
    localStorage.setItem(GLOBAL_FONT_KEY, css);
  } catch {
    // No storage: the next load shows the default until settings arrive.
  }
}

/** The last global font, before settings arrive, so the page doesn't flash. */
export function applyCachedGlobalFont(doc = document): void {
  try {
    const css = localStorage.getItem(GLOBAL_FONT_KEY);
    if (css) applyFontStylesheet(css, doc);
  } catch {
    // No storage: nothing cached.
  }
}
