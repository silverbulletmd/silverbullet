export const Fragment = "FRAGMENT";

export type Tag = {
  name: string;
  attrs?: Record<string, string | undefined>;
  body: Tag[] | string;
} | string;

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtml(t: Tag | null): string {
  if (!t) {
    return "";
  }
  if (typeof t === "string") {
    return htmlEscape(t);
  }
  const attrs = t.attrs
    ? " " + Object.entries(t.attrs)
      .filter(([, value]) => value !== undefined)
      .map(([k, v]) => `${k}="${htmlEscape(v!)}"`).join(
        " ",
      )
    : "";
  const body = typeof t.body === "string"
    ? htmlEscape(t.body)
    : t.body.map(renderHtml).join("");
  if (t.name === Fragment) {
    return body;
  }
  if (t.body) {
    return `<${t.name}${attrs}>${body}</${t.name}>`;
  } else {
    return `<${t.name}${attrs}/>`;
  }
}
