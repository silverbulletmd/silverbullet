// Pure, range-aware splice helper for the rename refactor.
//
// Given the source text of a page, a single relation's `range`, the
// old reference name, the new reference name, and the editing page's
// name (for relative-path resolution), returns the source text with
// that one reference rewritten in place.

// Forms handled:
//
// `[[OldName]]`
// `[[OldName|alias]]`
// `[[OldName#hdr]]`
// `[[OldName@123]]`
// `[[OldName$anchor]]` (not standard, but should be handled)
// `[text](OldName)`
// `[text](OldName#hdr)`
// `[text](/OldName)`
// `[text](<OldName with spaces>)`
// `[![alt](image.png)](OldName)`

import {
  absoluteToRelativePath,
  fileName,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  childrenWithin,
  markdownLinkParts,
} from "../../client/markdown_parser/markdown_link.ts";

export type SpliceArgs = {
  text: string;
  range: [number, number];
  oldName: string;
  newName: string;
  newWikiName?: string;
  // Page that owns the reference being rewritten (for relative-path math).
  pageToEdit: string;
  // Parse tree of the page before this batch of splices, to find the
  // destination of a markdown link. Splices are applied from the end of the
  // page, so its positions still hold up to the end of `range`.
  tree: ParseTree;
};

export function spliceReference(args: SpliceArgs): string {
  const { text, range, oldName, newName, pageToEdit, tree } = args;
  const newWikiName = args.newWikiName ?? newName;
  let [start, end] = range;
  let slice = text.substring(start, end);

  // Handle transclusions `![[Page]]`
  if (slice.startsWith("!")) {
    start += 1;
    slice = slice.substring(1);
  }

  if (slice.startsWith("[[")) {
    return spliceWikilink(text, start, end, oldName, newWikiName, newName);
  }
  if (slice.startsWith("[")) {
    const destination = markdownLinkDestinationAt(tree, range);
    // Leave the link alone if the text no longer holds what was parsed, as
    // on a CRLF page, whose carriage returns the parser drops
    if (
      !destination ||
      text.substring(...destination.range) !== destination.text
    ) {
      return text;
    }
    return spliceMarkdownLink(text, destination.range, newName, pageToEdit);
  }
  return text;
}

/** The destination of the markdown link or image spanning exactly `range` */
function markdownLinkDestinationAt(
  tree: ParseTree,
  [from, to]: [number, number],
): { range: [number, number]; text: string } | null {
  let destination: { range: [number, number]; text: string } | null = null;
  traverseTree(tree, (n) => {
    if (destination || n.from! > from || n.to! < to) return true;
    if (n.from !== from || n.to !== to) return false;
    if (n.type !== "Link" && n.type !== "Image") return false;
    const children = n.children ?? [];
    const parts = markdownLinkParts(children);
    if (parts) {
      const { destinationFrom, destinationTo } = parts;
      destination = {
        range: [destinationFrom, destinationTo],
        text: childrenWithin(children, destinationFrom, destinationTo)
          .map(renderToText)
          .join(""),
      };
    }
    return true;
  });
  return destination;
}

function spliceWikilink(
  text: string,
  start: number,
  end: number,
  oldName: string,
  newWikiName: string,
  newFullName: string,
): string {
  // [[ref(|alias)?]]
  const inner = text.substring(start + 2, end - 2);
  const pipeIdx = inner.indexOf("|");
  const refPart = pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner;
  const aliasPart = pipeIdx >= 0 ? inner.substring(pipeIdx) : "";

  // Preserve any detail suffix on the ref (@pos / #header / $anchor).
  // A caret link (`[[^Meta Page]]`) addresses a page by its full path and is
  // never shortened.
  const meta = refPart.startsWith("^");
  const body = meta ? refPart.slice(1) : refPart;
  const newName = meta ? newFullName : newWikiName;

  const detail = matchDetail(body);
  // Replace only when the basename matches the old name. (Defensive —
  // the indexer already filters by `to == oldName`, but if the index
  // is stale and a record points at something else, we leave it.)
  const basename = detail ? body.slice(0, -detail.length) : body;
  // Wikilinks conventionally omit the .md extension.
  const stripped = basename.endsWith(".md") ? basename.slice(0, -3) : basename;
  // The link may be written bare while the index records the resolved path, so
  // a bare name matching the old target's basename counts as a match too.
  if (stripped !== oldName && stripped !== fileName(oldName)) return text;

  const replacement = `[[${meta ? "^" : ""}${newName}${detail ?? ""}${aliasPart}]]`;
  return text.substring(0, start) + replacement + text.substring(end);
}

function spliceMarkdownLink(
  text: string,
  [start, end]: [number, number],
  newName: string,
  pageToEdit: string,
): string {
  // The destination: `url` or `<url with spaces>`
  const url = text.substring(start, end);
  const angled = url.startsWith("<") && url.endsWith(">");
  const urlBody = angled ? url.slice(1, -1) : url;

  const detail = matchDetail(urlBody);
  const isAbsolute = urlBody.startsWith("/");

  let newUrl: string;
  if (isAbsolute) {
    newUrl = `/${newName}`;
  } else {
    newUrl = absoluteToRelativePath(pageToEdit, newName);
  }
  if (detail) newUrl += detail;

  // Re-wrap in <> if the original was wrapped OR the new url contains
  // characters that require wrapping (spaces).
  const needsWrap = angled || newUrl.includes(" ");
  const wrappedUrl = needsWrap ? `<${newUrl}>` : newUrl;

  return text.substring(0, start) + wrappedUrl + text.substring(end);
}

// Matches a trailing `@123` / `@L4C5` / `#header` / `$anchor` ref
// detail. Returns the detail (including the leading sigil) or null.
function matchDetail(s: string): string | null {
  const m = s.match(/(@\d.*|@L\d.*|#.*|\$[A-Za-z_].*)$/);
  return m ? m[0] : null;
}
