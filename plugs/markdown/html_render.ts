export const Fragment = "FRAGMENT";

export type Tag = {
  name: string;
  attrs?: Record<string, string | undefined>;
  body: Tag[] | string;
} | string;

function htmlEscape(s: string): string {
  if (typeof s !== "string") {
    return s;
  }

  s = s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");

  let oldS = s;
  do {
    oldS = s;
    s = s.replace(/  /g, "&nbsp; ");
  } while (s !== oldS);
  return s;
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
  return `<${t.name}${attrs}>${body}</${t.name}>`;
}
