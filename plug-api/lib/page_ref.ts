/**
 * Represents a reference to a page, with optional position, anchor and header.
 */
export type PageRef = {
  page: string;
  pos?: number | { line: number; column: number };
  anchor?: string;
  header?: string;
  meta?: boolean;
};

/**
 * Checks if a name looks like a full path (with a file extension), is not a conflicted file and not a search page.
 */
export function looksLikePathWithExtension(name: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(name) && !/\.conflicted\./.test(name) &&
    !name.startsWith("🔍 ");
}

/**
 * Checks if a name looks like a full path (with a file extension), is not a conflicted file and not a search page.
 */
export function validatePageName(name: string) {
  // Page can not be empty and not end with a file extension (e.g. "bla.md")
  if (name === "") {
    throw new Error("Page name can not be empty");
  }
  if (name.startsWith(".")) {
    throw new Error("Page name cannot start with a '.'");
  }
  if (looksLikePathWithExtension(name)) {
    throw new Error("Page name can not end with a file extension");
  }
}

const posRegex = /@(\d+)$/;
const linePosRegex = /@[Ll](\d+)(?:[Cc](\d+))?$/; // column is optional, implicit 1
const anchorRegex = /\$([a-zA-Z\.\-\/]+[\w\.\-\/]*)$/;
const headerRegex = /#([^#]*)$/;

/**
 * Parses a page reference string into a PageRef object.
 * @param name the name of the page reference to parse
 * @returns the parsed PageRef object
 */
export function parsePageRef(name: string): PageRef {
  // Normalize the page name
  if (name.startsWith("[[") && name.endsWith("]]")) {
    name = name.slice(2, -2);
  }
  const pageRef: PageRef = { page: name };
  if (pageRef.page.startsWith("^")) {
    // A caret prefix means we're looking for a meta page, but that doesn't matter for most use cases
    pageRef.page = pageRef.page.slice(1);
    pageRef.meta = true;
  }
  const posMatch = pageRef.page.match(posRegex);
  if (posMatch) {
    pageRef.pos = parseInt(posMatch[1]);
    pageRef.page = pageRef.page.replace(posRegex, "");
  }
  const linePosMatch = pageRef.page.match(linePosRegex);
  if (linePosMatch) {
    pageRef.pos = { line: parseInt(linePosMatch[1]), column: 1 };
    if (linePosMatch[2]) {
      pageRef.pos.column = parseInt(linePosMatch[2]);
    }
    pageRef.page = pageRef.page.replace(linePosRegex, "");
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

/**
 * The inverse of parsePageRef, encodes a PageRef object into a string.
 * @param pageRef the page reference to encode
 * @returns a string representation of the page reference
 */
export function encodePageRef(pageRef: PageRef): string {
  let name = pageRef.page;
  if (pageRef.pos) {
    if (pageRef.pos instanceof Object) {
      name += `@L${pageRef.pos.line}`;
      if (pageRef.pos.column !== 1) {
        name += `C${pageRef.pos.column}`;
      }
    } else { // just a number
      name += `@${pageRef.pos}`;
    }
  }
  if (pageRef.anchor) {
    name += `$${pageRef.anchor}`;
  }
  if (pageRef.header) {
    name += `#${pageRef.header}`;
  }
  return name;
}

/**
 * Translate line and column number (counting from 1) to position in text (counting from 0)
 */
export function positionOfLine(
  text: string,
  line: number,
  column: number,
): number {
  const lines = text.split("\n");
  let targetLine = "";
  let targetPos = 0;
  for (let i = 0; i < line && lines.length; i++) {
    targetLine = lines[i];
    targetPos += targetLine.length;
  }
  // How much to move inside the line, column number starts from 1
  const columnOffset = Math.max(
    0,
    Math.min(targetLine.length, column - 1),
  );
  return targetPos - targetLine.length + columnOffset;
}
