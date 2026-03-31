export const Fragment = "FRAGMENT";
export const RawHtml = "RAW_HTML";

export type Tag =
  | {
      name: string;
      attrs?: Record<string, string | undefined>;
      body: Tag[] | string;
    }
  | string;

export function htmlEscape(s: string): string {
  if (typeof s !== "string") {
    return s;
  }

  s = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");

  let oldS = s;
  do {
    oldS = s;
    s = s.replace(/ {2}/g, "&nbsp; ");
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
    ? ` ${Object.entries(t.attrs)
        .filter(([, value]) => value !== undefined)
        .map(([k, v]) => `${k}="${htmlEscape(v!)}"`)
        .join(" ")}`
    : "";
  const body =
    typeof t.body === "string"
      ? htmlEscape(t.body)
      : t.body.map(renderHtml).join("");
  if (t.name === Fragment) {
    return body;
  }
  if (t.name === RawHtml) {
    if (typeof t.body === "string") {
      return t.body;
    }
    return t.body.map((c) =>
      typeof c === "string" ? c : renderHtml(c)
    ).join("");
  }
  return `<${t.name}${attrs}>${body}</${t.name}>`;
}
