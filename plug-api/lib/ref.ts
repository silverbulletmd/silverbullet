import {
  findNodeMatching,
  findNodeOfType,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";

/**
 * Represents a path with an extension. This is a little cursed, but enforces
 * that people check the path before setting it. For navigation logic the empty
 * path will point to the index page. This could differ for e.g. for the
 * wikilink logic where it points to the currentPage
 */
export type Path = `${string}.${string}` | "";

/**
 * Represents a reference to a page or document, with optional position, anchor and header
 */
export type Ref = {
  path: Path;
  meta?: boolean;

  details?:
    | { type: "position"; pos: number }
    | { type: "linecolumn"; line: number; column: number }
    | { type: "header"; header: string };
};

/**
 * Determines the file extension of a ref. It will only return the last
 * extension, so `foo.tar.gz` resolves to `gz`
 * @returns The file extension WITHOUT the dot
 */
export function getPathExtension(path: Path): string {
  // If the ref links to the the file it's on (i.e. path === ""), it's safe to assume it's a link to a "md" page
  return path !== "" ? path.split(".").pop()!.toLowerCase() : "md";
}

/**
 * Renders a path into a "name". This means it removes the extension for `.md` path
 */
export function getNameFromPath(path: Path): string {
  return encodeRef({ path });
}

/**
 * Determines there a ref points to a markdown file
 */
export function isMarkdownPath(path: Path): boolean {
  return getPathExtension(path) === "md";
}

/**
 * Adds an `md` extension to any path without an extension or a path ending in
 * `.conflicted`, except to the empty path
 * @param path The path to normalize. Cannot contain any position or header
 * addons
 */
function normalizePath(path: string): Path {
  if (path.startsWith("/")) {
    path = path.slice(1);
  }

  if (/.+\.[a-zA-Z0-9]+$/.test(path) || path === "") {
    return path as Path;
  }

  return `${path}.md`;
}

/**
 * Determines wether a name conforms to all the requirments.
 */
export function isValidName(name: string): boolean {
  const ref = parseToRef(name);

  // If the name, parses as a link and doesn't provide any other info we can be
  // sure it was only parsed as a path and that the path then conforms to all
  // the requirements
  return !!ref && !ref.details && !ref.meta && name !== "" &&
    encodeRef(ref) === name;
}

/**
 * Determines wether a path conforms to all the requirments.
 */
export function isValidPath(path: string): path is Path {
  const ref = parseToRef(path);

  return !!ref && ref.path === path;
}

/**
 * ONLY TOUCH THIS IF YOU REALLY KNOW WHAT YOU ARE DOING. THIS REGEX IS INTEGRAL
 * TO THE INNER WORKINGS OF SILVERBULLET AND CHANGES COULD INTRODUCE MAJOR BUGS
 */
const refRegex =
  /^(?<meta>\^)?(?<path>(?!.*\.[a-zA-Z0-9]+\.md$)(?!\/?(\.|\^))(?!.*(?:\/|^)\.{1,2}(?:\/|$)|.*\/{2})(?!.*(?:\]\]|\[\[))[^@#\|<>]*)(@(?<pos>\d+)|@[Ll](?<line>\d+)(?:[Cc](?<col>\d+))?|#\s*(?<header>.*))?$/;

/**
 * Parses a reference string into a ref object.
 * @returns A ref or if the parsing fails null
 */
export function parseToRef(stringRef: string): Ref | null {
  const match = stringRef.match(refRegex);
  if (!match || !match.groups) {
    return null;
  }

  const groups = match.groups;

  const ref: Ref = { path: normalizePath(groups.path) };

  if (groups.meta) {
    ref.meta = true;
  }

  if (groups.pos !== undefined) {
    ref.details = {
      type: "position",
      pos: parseInt(groups.pos),
    };
  } else if (groups.line !== undefined) {
    ref.details = {
      type: "linecolumn",
      line: parseInt(groups.line),
      column: groups.col !== undefined ? parseInt(groups.col) : 1,
    };
  } else if (groups.header !== undefined) {
    ref.details = {
      type: "header",
      header: groups.header,
    };
  }

  return ref;
}

/**
 * The inverse of {@link parseToRef}, encodes a ref object into a reference string.
 * It tries to produce the shortest valid representation
 */
export function encodeRef(ref: Ref): string {
  let stringRef: string = ref.path;

  if (isMarkdownPath(ref.path)) {
    stringRef = stringRef.slice(0, -3);
  }

  if (ref.details?.type === "linecolumn") {
    stringRef += `@L${ref.details.line}`;

    if (ref.details.column !== 1) {
      stringRef += `C${ref.details.column}`;
    }
  } else if (ref.details?.type === "position") {
    stringRef += `@${ref.details.pos}`;
  } else if (ref.details?.type === "header") {
    stringRef += `#${ref.details.header}`;
  }

  return stringRef;
}

/**
 * Uses a parseTree and a ref pointing to a position inside it to determine the
 * offset from the start inside it, using {@link getOffsetFromHeader} and
 * {@link getOffsetFromLineColumn}
 * @param text If provided the parseTree won't be rendered back to text
 * @returns The offset in the file if it's able to determine it, otherwise -1
 */
export function getOffsetFromRef(
  parseTree: ParseTree,
  ref: Ref,
  text?: string,
): number {
  if (!ref.details) {
    return -1;
  }

  switch (ref.details.type) {
    case "position":
      return ref.details.pos;
    case "linecolumn":
      return getOffsetFromLineColumn(
        text ?? renderToText(parseTree),
        ref.details.line,
        ref.details.column,
      );
    case "header": {
      return getOffsetFromHeader(parseTree, ref.details.header);
    }
  }
}

/**
 * Find the header inside a {@link ParseTree} and returns the position the end
 * of the header
 * @param parseTree The parse tree. Can e.g. be generate using
 * `markdown.parseMarkdown`
 * @param header The header, spaces at the start or end are ignored
 * @returns The position of the header inside the document, if it can't be found
 * -1
 */
export function getOffsetFromHeader(
  parseTree: ParseTree,
  header: string,
): number {
  const node = findNodeMatching(
    parseTree,
    (subTree) => {
      if (!subTree.type || !subTree.type.startsWith("ATXHeading")) {
        return false;
      }

      const mark = findNodeOfType(subTree, "HeaderMark");
      if (!mark || mark.from === undefined || mark.to === undefined) {
        return false;
      }

      return renderToText(subTree)
        .slice(mark.to - mark.from)
        .trimStart() === header.trim();
    },
  );

  if (!node) {
    return -1;
  }

  return node.to ?? -1;
}

/**
 * Calculates the character offset from a line and column position. If the
 * position is out of bounds, it does a best-effort job returning a position.
 * @param text The text which is used to determine the offset. Only `\n` are
 * considered line breaks.
 * @param line The line number of the described position. Starts at 1
 * @param column The column number of the described position. Starts at 0
 */
export function getOffsetFromLineColumn(
  text: string,
  line: number,
  column: number,
): number {
  const lines = text.split("\n");

  const linePos = lines
    .slice(0, Math.max(line - 1, 0))
    .map((l) => l.length)
    .reduce((totalLen, len) => totalLen + len, 0);

  const columnPos = Math.max(
    0,
    Math.min(lines[line - 1]?.length ?? 0, column - 1),
  );

  return linePos + columnPos;
}

/**
 * Encodes a page name for use in a URI. Basically does
 * {@link encodeURIComponent}, but puts slashes back in place.
 */
export function encodePageURI(page: string): string {
  return encodeURIComponent(page).replace(/%2F/g, "/");
}

/**
 * Decodes a page name from a URI.
 */
export function decodePageURI(page: string): string {
  return decodeURIComponent(page);
}
