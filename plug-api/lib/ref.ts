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
    | { type: "header"; header: string }
    | { type: "anchor"; name: string };
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
  return (
    !!ref && !ref.details && !ref.meta && name !== "" && encodeRef(ref) === name
  );
}

/**
 * Determines wether a path conforms to all the requirments.
 */
export function isValidPath(path: string): path is Path {
  const ref = parseToRef(path);

  return !!ref && ref.path === path && path !== "";
}

/**
 * ONLY TOUCH THIS IF YOU REALLY KNOW WHAT YOU ARE DOING. THIS REGEX IS INTEGRAL
 * TO THE INNER WORKINGS OF SILVERBULLET AND CHANGES COULD INTRODUCE MAJOR BUGS
 */
const refRegex =
  /^(?<meta>\^)?(?<path>(?!.*\.[a-zA-Z0-9]+\.md$)(?!\/?(\.|\^))(?!.*(?:\/|^)\.{1,2}(?:\/|$)|.*\/{2})(?!.*(?:\]\]|\[\[))[^@#|<>$]*)(@(?<pos>\d+)|@[Ll](?<line>\d+)(?:[Cc](?<col>\d+))?|#\s*(?<header>.*)|\$(?<anchor>[A-Za-z_][A-Za-z0-9_/:-]*))?$/;

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
      pos: parseInt(groups.pos, 10),
    };
  } else if (groups.line !== undefined) {
    ref.details = {
      type: "linecolumn",
      line: parseInt(groups.line, 10),
      column: groups.col !== undefined ? parseInt(groups.col, 10) : 1,
    };
  } else if (groups.header !== undefined) {
    ref.details = {
      type: "header",
      header: groups.header,
    };
  } else if (groups.anchor !== undefined) {
    ref.details = { type: "anchor", name: groups.anchor };
  }

  return ref;
}

/**
 * Coerces a ref-or-string (including the legacy `{ page, pos, header }` shape)
 * into a {@link Ref} and validates its structure, throwing on malformed input.
 * Used wherever an external caller (e.g. a syscall) hands in a ref that may be a
 * string or a legacy object.
 */
export function coerceAndValidateRef(ref: Ref | string): Ref {
  if (typeof ref === "string") {
    const parsedRef = parseToRef(ref);
    if (!parsedRef) {
      throw new Error("Unable to parse string as ref");
    }
    ref = parsedRef;
  }

  if (
    // @ts-expect-error: Legacy support
    ref.page !== undefined
  ) {
    console.warn(
      "You are using legacy navigation syntax (`{ page, pos, header }`), this will be phased out in the future",
    );

    const legacyRef = ref as unknown as {
      kind: "page" | "document";
      page: string;
      pos?: number | { line: number; column: number };
      header?: string;
      meta?: boolean;
    };

    legacyRef.kind ??= "page";

    let details: Ref["details"];

    if (typeof legacyRef.pos === "number") {
      details = { type: "position", pos: legacyRef.pos };
    } else if (legacyRef.pos) {
      details = {
        type: "linecolumn",
        line: legacyRef.pos.line,
        column: legacyRef.pos.column,
      };
    } else if (legacyRef.header) {
      details = { type: "header", header: legacyRef.header };
    }

    ref = {
      path: (legacyRef.kind === "page"
        ? `${legacyRef.page}.md`
        : legacyRef.page) as Path,
      details,
      meta: legacyRef.meta,
    };
  }

  if (!isValidPath(ref.path) && ref.path !== "") {
    throw new Error("Path passed in ref is invalid");
  } else if (typeof ref.meta !== "boolean" && ref.meta !== undefined) {
    throw new Error("ref.meta has to be of type `boolean`");
  } else if (ref.details !== undefined && typeof ref.details !== "object") {
    throw new Error("ref.details has to be of type `object` or `undefined`");
  } else if (
    ref.details &&
    !["position", "linecolumn", "header", "anchor"].includes(ref.details.type)
  ) {
    throw new Error(
      "ref.details.type has to be 'position', 'linecolumn', 'header' or 'anchor'",
    );
  }

  if (
    ref.details?.type === "position" &&
    typeof ref.details.pos !== "number"
  ) {
    throw new Error("ref.details.pos has to be of type `number`");
  } else if (
    ref.details?.type === "header" &&
    typeof ref.details.header !== "string"
  ) {
    throw new Error("ref.details.header has to be of type `string`");
  } else if (
    ref.details?.type === "linecolumn" &&
    typeof ref.details.line !== "number" &&
    typeof ref.details.column !== "number"
  ) {
    throw new Error(
      "ref.details.line and ref.details.column has to be of type `number`",
    );
  } else if (
    ref.details?.type === "anchor" &&
    typeof ref.details.name !== "string"
  ) {
    throw new Error("ref.details.name has to be of type `string`");
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
  } else if (ref.details?.type === "anchor") {
    stringRef += `$${ref.details.name}`;
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
    case "anchor":
      return -1;
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
  const node = findNodeMatching(parseTree, (subTree) => {
    if (!subTree.type || !subTree.type.startsWith("ATXHeading")) {
      return false;
    }

    const mark = findNodeOfType(subTree, "HeaderMark");
    if (!mark || mark.from === undefined || mark.to === undefined) {
      return false;
    }

    return (
      renderToText(subTree)
        .slice(mark.to - mark.from)
        .trimStart() === header.trim()
    );
  });

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

/**
 * A service with selector `customizePageTitle` has a default impl in the Std plug (priority 1), which may be
 * overridden by other plugs. The service is provided a ref encoded ({@link encodeRef}) path of the current page.
 */
export async function customizePageTitleViaService(): Promise<string> {
  if (client.ui.viewState.current === undefined) {
    return new Promise(function (resolve, _reject) {
      resolve("");
    });
  } else {
    let path = getNameFromPath(client.ui.viewState.current.path);

    const services = await client.clientSystem.serviceRegistry.discover(
      "customizePageTitle",
      path,
    );

    if (services.length === 0) {
      return new Promise(function (resolve, _reject) {
        // Just give the path until we have service. This can happen during big index jobs
        resolve(path);
      });
    } else {
      return await client.clientSystem.serviceRegistry.invoke(
        services[0],
        path,
      );
    }
  }
}
