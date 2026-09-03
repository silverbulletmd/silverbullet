import { Fragment, type Tag } from "./html_render.ts";

// Elements whose mere presence executes code or embeds a foreign document.
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "base",
]);

// Attributes that carry a URL and could hold a javascript:/data: payload.
const URL_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "formaction",
  "action",
]);

export function isSafeUrl(url: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip the control chars (0x00-0x1F) that browsers remove from URLs before scheme resolution, so obfuscated `java\tscript:` etc. cannot slip past the scheme check.
  const stripped = url.replace(/[\t\n\r\x00-\x1f]/g, "");
  const m = /^\s*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped);
  if (!m) {
    return true; // no scheme → relative/anchor/local
  }
  const scheme = m[1].toLowerCase();
  return (
    scheme === "http" ||
    scheme === "https" ||
    scheme === "mailto" ||
    scheme === "tel"
  );
}

export function sanitizeTag(tag: Tag): Tag {
  if (typeof tag === "string") {
    return tag;
  }
  if (FORBIDDEN_ELEMENTS.has(tag.name.toLowerCase())) {
    return { name: Fragment, body: [] }; // drop element and contents
  }
  if (tag.attrs) {
    const cleaned: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(tag.attrs)) {
      const k = key.toLowerCase();
      if (k.startsWith("on")) {
        continue; // event handler
      }
      if (URL_ATTRS.has(k) && typeof value === "string" && !isSafeUrl(value)) {
        continue; // unsafe URL scheme
      }
      cleaned[key] = value;
    }
    tag.attrs = cleaned;
  }
  if (Array.isArray(tag.body)) {
    tag.body = tag.body.map(sanitizeTag);
  }
  return tag;
}
