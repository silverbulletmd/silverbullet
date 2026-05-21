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

import { absoluteToRelativePath } from "@silverbulletmd/silverbullet/lib/resolve";

export type SpliceArgs = {
  text: string;
  range: [number, number];
  oldName: string;
  newName: string;
  // Page that owns the reference being rewritten (for relative-path math).
  pageToEdit: string;
};

export function spliceReference(args: SpliceArgs): string {
  const { text, range, oldName, newName, pageToEdit } = args;
  const [start, end] = range;
  const slice = text.substring(start, end);

  if (slice.startsWith("[[")) {
    return spliceWikilink(text, start, end, oldName, newName);
  }
  if (slice.startsWith("[")) {
    return spliceMarkdownLink(text, start, end, newName, pageToEdit);
  }
  return text;
}

function spliceWikilink(
  text: string,
  start: number,
  end: number,
  oldName: string,
  newName: string,
): string {
  // [[ref(|alias)?]]
  const inner = text.substring(start + 2, end - 2);
  const pipeIdx = inner.indexOf("|");
  const refPart = pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner;
  const aliasPart = pipeIdx >= 0 ? inner.substring(pipeIdx) : "";

  // Preserve any detail suffix on the ref (@pos / #header / $anchor).
  const detail = matchDetail(refPart);
  // Replace only when the basename matches the old name. (Defensive —
  // the indexer already filters by `to == oldName`, but if the index
  // is stale and a record points at something else, we leave it.)
  const basename = detail ? refPart.slice(0, -detail.length) : refPart;
  // Strip a trailing `.md` if the user wrote one — wikilinks
  // conventionally omit the extension and the legacy refactor did
  // this too (the `link.toPage` was always without `.md`).
  const stripped = basename.endsWith(".md")
    ? basename.slice(0, -3)
    : basename;
  if (stripped !== oldName) return text;

  const replacement = `[[${newName}${detail ?? ""}${aliasPart}]]`;
  return text.substring(0, start) + replacement + text.substring(end);
}

function spliceMarkdownLink(
  text: string,
  start: number,
  end: number,
  newName: string,
  pageToEdit: string,
): string {
  // [text](url) or [text](<url with spaces>)
  const slice = text.substring(start, end);
  const m = slice.match(/^(\[[^\]]*\]\()(<)?([^)]*?)(>)?(\))$/);
  if (!m) return text;
  const [, leftBracketText, openAngle, urlBody, closeAngle, closeParen] = m;
  if (!!openAngle !== !!closeAngle) return text; // mismatched < >

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
  const needsWrap = !!openAngle || newUrl.includes(" ");
  const wrappedUrl = needsWrap ? `<${newUrl}>` : newUrl;

  return text.substring(0, start) +
    leftBracketText + wrappedUrl + closeParen +
    text.substring(end);
}

// Matches a trailing `@123` / `@L4C5` / `#header` / `$anchor` ref
// detail. Returns the detail (including the leading sigil) or null.
function matchDetail(s: string): string | null {
  const m = s.match(/(@\d.*|@L\d.*|#.*|\$[A-Za-z_].*)$/);
  return m ? m[0] : null;
}
