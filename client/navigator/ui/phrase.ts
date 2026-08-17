/**
 * Phrase-level mechanics of the filter input: hashtag pre-filtering, and the
 * two path-completion gestures. All pure, all off the panel's own state, so
 * they stay testable and stay out of the keystroke hot path's way.
 */

import { extractHashtag } from "../../../plug-api/lib/tags.ts";
import type { Row } from "./types.ts";

// The markdown tag syntax. Copied rather than imported from
// `client/markdown_parser/constants.ts`, which the panel bundle must not reach
// into -- it is client code, and pulling it in would drag the markdown parser
// across the iframe boundary to read one regex. `extractHashtag` above has no
// such problem: it lives in plug-api, which is exactly what this side may use.
const TAG_SOURCE =
  /#(?:(?:\d*[^\d\s!@#$%^&*(),.?":{}|<>\\][^\s!@#$%^&*(),.?":{}|<>\\]*)|(?:<[^>\n]+>))/
    .source;
const tagRegex = new RegExp(TAG_SOURCE, "g");

export type PhraseParts = {
  /** Bare tag names the phrase named, without their `#`. */
  tags: string[];
  /** What is left to rank against, with the tags taken out. */
  rest: string;
};

/**
 * Splits `meeting #work` into the tags it filters by and the phrase that
 * ranks -- matching the old page picker, where a `#tag` in the phrase is a
 * filter rather than something to fuzzy-match against a page name.
 */
export function splitHashtags(phrase: string): PhraseParts {
  const matches = phrase.match(tagRegex);
  if (!matches) return { tags: [], rest: phrase };
  return {
    tags: matches.map(extractHashtag),
    rest: phrase.replaceAll(tagRegex, "").trim(),
  };
}

/**
 * Whether a row carries every named tag. Prefix matching: `#meet` finds
 * `#meeting`. A row with no tags at all matches nothing, so a tagged phrase
 * never falls back to the whole space.
 */
export function matchesTags(row: Row, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const own = row.obj?.tags;
  if (!Array.isArray(own)) return false;
  return tags.every((tag) =>
    own.some((it: unknown) => typeof it === "string" && it.startsWith(tag)),
  );
}

/**
 * What `Space` on an empty phrase inserts: the folder the current path sits
 * in, or -- at the root, where there is no folder -- the current page's own
 * name as a folder.
 */
export function folderPrefix(path: string): string {
  const withoutExtension = path.replace(/\.md$/, "");
  const parts = withoutExtension.split("/");
  const folder = parts.slice(0, -1).join("/");
  return `${folder || parts[parts.length - 1] || ""}/`;
}

/**
 * Which row `Alt-Space` completes against. The top-ranked row is the natural
 * candidate, but once the phrase equals its name that row has nothing left to
 * offer -- and stopping there would strand the walk one level above a deeper
 * hierarchy. So the first row that can actually extend the phrase wins, and
 * the top row is only the fallback (which is also what keeps the "phrase
 * matches nothing by prefix" case working -- see `completeSegment`).
 */
export function completionCandidate(
  names: string[],
  value: string,
): string | undefined {
  const typed = value.trimEnd().toLowerCase();
  const deeper = names.find(
    (name) =>
      name.length > typed.length && name.toLowerCase().startsWith(typed),
  );
  return deeper ?? names[0];
}

/**
 * What `Alt-Space` completes the phrase to, given the candidate row's name:
 * the next `/`-separated segment of it, or -- when the phrase isn't a prefix
 * of that name at all -- the name's first segment. Returns undefined when
 * there is nothing to complete to.
 */
export function completeSegment(
  value: string,
  candidate: string | undefined,
): string | undefined {
  if (!candidate) return undefined;
  const typed = value.trimEnd();
  if (!candidate.toLowerCase().startsWith(typed.toLowerCase())) {
    return `${candidate.split("/")[0]}/`;
  }
  const nextSlash = candidate.indexOf("/", typed.length + 1);
  return nextSlash === -1 ? candidate : candidate.slice(0, nextSlash);
}
