// Pure helpers for the "Baked Sections" feature
//
// A baked section is an `<!--#lua EXPR -->` ... `<!--/lua-->` block: the EXPR is
// the source Lua expression and the text between the markers is its baked
// (rendered) markdown body.

/** Exact closing marker of a baked section. */
const CLOSE_MARKER = "<!--/lua-->";

/** Matches an opening marker `<!--#lua EXPR -->`, capturing EXPR (non-greedy
 *  so it stops at the first `-->`). Global: callers reset lastIndex. */
const OPEN_RE = /<!--#lua\s+([\s\S]*?)-->/g;

export interface BakedSection {
  // The Lua expression text from the opening marker, trimmed.
  expr: string;
  // Document offset at the start of the opening `<!--#lua` marker.
  start: number;
  // Document offset just after the closing `<!--/lua-->` marker.
  end: number;
  // Document offset immediately after the opening marker's `-->`.
  bodyFrom: number;
  // Document offset at the start of the closing `<!--/lua-->` marker.
  bodyTo: number;
}

/**
 * Find every baked sectionin `text`.
 * Returns them in document order; non-overlapping. An opening marker without a
 * matching close is skipped (left untouched by the caller).
 */
export function findBakedSections(text: string): BakedSection[] {
  const sections: BakedSection[] = [];
  OPEN_RE.lastIndex = 0; // OPEN_RE is global/stateful, reset per call.
  let m: RegExpExecArray | null;
  while ((m = OPEN_RE.exec(text)) !== null) {
    const bodyFrom = m.index + m[0].length;
    const closeIdx = text.indexOf(CLOSE_MARKER, bodyFrom);
    if (closeIdx === -1) {
      continue; // unclosed opening marker — leave it alone
    }
    const end = closeIdx + CLOSE_MARKER.length;
    sections.push({
      expr: m[1].trim(),
      start: m.index,
      end,
      bodyFrom,
      bodyTo: closeIdx,
    });
    OPEN_RE.lastIndex = end;
  }
  return sections;
}

/**
 * Neutralize any literal closing marker inside a baked body so a later update
 * doesn't mistake it for the end of the section. Inserting spaces breaks the
 * exact `<!--/lua-->` match while keeping the text a valid HTML comment.
 */
export function escapeBakedBody(markdown: string): string {
  return markdown.replaceAll(CLOSE_MARKER, "<!-- /lua -->");
}
