import { CORE_ICONS } from "./core.generated.ts";
import { DEPRECATED_ICONS } from "./deprecations.ts";
import type { IconData, IconKeywords, IconNode } from "./types.ts";

export const FALLBACK_ICON = "circle-question-mark";

export type IconSource =
  | { url: string; keywordsUrl?: string }
  | { data: IconData; keywords?: IconKeywords };

export type IconSvgOptions = { size?: number; class?: string };

let data: IconData = CORE_ICONS;
let fullLoaded = true;
let source: IconSource | undefined;
let loading: Promise<void> | undefined;
let keywords: Promise<IconKeywords> | undefined;
const listeners = new Set<() => void>();
const warned = new Set<string>();

/** Where the full icon set comes from; without a call only core icons exist. */
export function configureIcons(next: IconSource): void {
  source = next;
  loading = undefined;
  keywords = undefined;
  warned.clear();
  if ("data" in next) {
    data = next.data;
    fullLoaded = true;
    if (next.keywords) keywords = Promise.resolve(next.keywords);
  } else {
    data = CORE_ICONS;
    fullLoaded = false;
  }
}

export function iconsLoaded(): boolean {
  return fullLoaded;
}

/** Fetches the full set once; a failure is logged and non-core names fall back. */
export function loadIcons(): Promise<void> {
  if (fullLoaded) return Promise.resolve();
  if (!source || !("url" in source)) {
    fullLoaded = true;
    return Promise.resolve();
  }
  const url = source.url;
  loading ??= (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const full: IconData = await response.json();
      data = {
        icons: { ...full.icons, ...CORE_ICONS.icons },
        aliases: { ...full.aliases, ...CORE_ICONS.aliases },
      };
    } catch (e: any) {
      console.warn(`Could not load icons from ${url}: ${e.message}`);
    }
    fullLoaded = true;
    for (const listener of [...listeners]) listener();
  })();
  return loading;
}

export function onIconsLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function warnOnce(name: string, message: string) {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(message);
}

type Lookup =
  | { kind: "none" }
  | { kind: "icon"; name: string }
  | { kind: "pending" }
  | { kind: "unknown" };

function lookup(value: unknown): Lookup {
  if (typeof value !== "string") return { kind: "none" };
  let name = value.trim().toLowerCase();
  if (!name) return { kind: "none" };
  if (name.startsWith("<")) {
    warnOnce(
      "<svg>",
      "Inline SVG icons are no longer supported; use a Lucide icon name (https://lucide.dev/icons)",
    );
    return { kind: "unknown" };
  }
  if (name.startsWith("feather:")) name = name.slice("feather:".length);
  if (name in DEPRECATED_ICONS) {
    const replacement = DEPRECATED_ICONS[name];
    warnOnce(
      name,
      replacement
        ? `Icon "${name}" is deprecated; use "${replacement}"`
        : `Icon "${name}" is no longer available; pick another Lucide icon`,
    );
    if (!replacement) return { kind: "unknown" };
    name = replacement;
  }
  const canonical = data.aliases[name] ?? name;
  if (data.icons[canonical]) return { kind: "icon", name: canonical };
  if (!fullLoaded) return { kind: "pending" };
  warnOnce(name, `Unknown icon "${name}"; see https://lucide.dev/icons`);
  return { kind: "unknown" };
}

/** The canonical Lucide name for an icon value, or undefined when it has none. */
export function resolveIconName(value: unknown): string | undefined {
  const result = lookup(value);
  return result.kind === "icon" ? result.name : undefined;
}

const escapeAttr = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function renderSvg(
  name: string,
  node: IconNode,
  opts: IconSvgOptions = {},
): string {
  const size = opts.size ?? 24;
  const cls = ["sb-icon", `lucide-${name}`, opts.class].filter(Boolean);
  const children = node
    .map(
      ([tag, attrs]) =>
        `<${tag}${Object.entries(attrs)
          .filter(([key]) => key !== "key")
          .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
          .join("")}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${escapeAttr(cls.join(" "))}" aria-hidden="true">${children}</svg>`;
}

function placeholderSvg(opts: IconSvgOptions = {}): string {
  const size = opts.size ?? 24;
  const cls = ["sb-icon", opts.class].filter(Boolean).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" class="${escapeAttr(cls)}" aria-hidden="true"></svg>`;
}

/** SVG markup for an icon value: the fallback glyph when unknown, "" when there is none. */
export function iconSvg(value: unknown, opts?: IconSvgOptions): string {
  const result = lookup(value);
  switch (result.kind) {
    case "none":
      return "";
    case "pending":
      return placeholderSvg(opts);
    case "icon":
      return renderSvg(result.name, data.icons[result.name], opts);
    case "unknown":
      return renderSvg(FALLBACK_ICON, data.icons[FALLBACK_ICON], opts);
  }
}

/** Strict variant for APIs: null when the name isn't an icon. */
export function iconSvgOrNull(
  value: string,
  opts?: IconSvgOptions,
): string | null {
  const name = resolveIconName(value);
  return name ? renderSvg(name, data.icons[name], opts) : null;
}

/** A DOM element for an icon value that fills itself in once the full set loads. */
export function iconElement(
  value: unknown,
  opts?: IconSvgOptions,
): HTMLElement {
  const span = document.createElement("span");
  span.className = "sb-icon-wrap";
  const render = () => {
    span.innerHTML = iconSvg(value, opts);
  };
  render();
  if (!fullLoaded && lookup(value).kind === "pending") {
    const off = onIconsLoaded(() => {
      off();
      render();
    });
  }
  return span;
}

/** Every canonical icon name currently available, sorted. */
export function iconNames(): string[] {
  return Object.keys(data.icons).sort();
}

/** Search keywords per canonical name; empty when they can't be loaded. */
export function iconKeywords(): Promise<IconKeywords> {
  if (!keywords) {
    const url = source && "url" in source ? source.keywordsUrl : undefined;
    keywords = url
      ? fetch(url)
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({}))
      : Promise.resolve({});
  }
  return keywords;
}
