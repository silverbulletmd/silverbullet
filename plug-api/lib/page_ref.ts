export function validatePageName(name: string) {
  // Page can not be empty and not end with a file extension (e.g. "bla.md")
  if (name === "") {
    throw new Error("Page name can not be empty");
  }
  if (name.startsWith(".")) {
    throw new Error("Page name cannot start with a '.'");
  }
  if (/\.[a-zA-Z]+$/.test(name)) {
    throw new Error("Page name can not end with a file extension");
  }
}

export type PageRef = {
  page: string;
  pos?: number;
  anchor?: string;
  header?: string;
};

const posRegex = /@(\d+)$/;
// Should be kept in sync with the regex in index.plug.yaml
const anchorRegex = /\$([a-zA-Z\.\-\/]+[\w\.\-\/]*)$/;
const headerRegex = /#([^#]*)$/;

export function parsePageRef(name: string): PageRef {
  // Normalize the page name
  if (name.startsWith("[[") && name.endsWith("]]")) {
    name = name.slice(2, -2);
  }
  const pageRef: PageRef = { page: name };
  const posMatch = pageRef.page.match(posRegex);
  if (posMatch) {
    pageRef.pos = parseInt(posMatch[1]);
    pageRef.page = pageRef.page.replace(posRegex, "");
  }
  const anchorMatch = pageRef.page.match(anchorRegex);
  if (anchorMatch) {
    pageRef.anchor = anchorMatch[1];
    pageRef.page = pageRef.page.replace(anchorRegex, "");
  }
  const headerMatch = pageRef.page.match(headerRegex);
  if (headerMatch) {
    pageRef.header = headerMatch[1];
    pageRef.page = pageRef.page.replace(headerRegex, "");
  }
  return pageRef;
}

export function encodePageRef(pageRef: PageRef): string {
  let name = pageRef.page;
  if (pageRef.pos) {
    name += `@${pageRef.pos}`;
  }
  if (pageRef.anchor) {
    name += `$${pageRef.anchor}`;
  }
  if (pageRef.header) {
    name += `#${pageRef.header}`;
  }
  return name;
}
