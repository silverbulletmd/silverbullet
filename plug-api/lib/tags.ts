/** Check if a tag marks a page as a meta page (exact "meta" or "meta/..." subtag) */
export function isMetaTag(tag: string): boolean {
  return tag === "meta" || tag.startsWith("meta/");
}

/** Extract the name from hashtag text, removing # prefix and <angle brackets> if necessary */
export function extractHashtag(text: string): string {
  if (text[0] !== "#") {
    console.error("extractHashtag called on already clean string", text);
    return text;
  } else if (text[1] === "<") {
    if (text.slice(-1) !== ">") {
      // this is malformed: #<name but maybe we're trying to autocomplete
      return text.slice(2);
    } else {
      return text.slice(2, -1);
    }
  } else {
    return text.slice(1);
  }
}

/**
 * How a built-in tag relates to the objects carrying it:
 * - root: one per object, its `tag` attribute; maps to a Markdown element or file
 * - system: a Markdown block that configures SilverBullet rather than holding content
 * - edge: connects two objects
 * - index: a record the index keeps about itself, with no Markdown of its own
 *
 * User-defined root tags (from ```#name data blocks) are not listed here;
 * their objects carry "data" in `itags`.
 */
export type TagKind = "root" | "system" | "edge" | "index";

export const BUILTIN_TAG_KINDS: Readonly<Record<string, TagKind>> = {
  page: "root",
  document: "root",
  item: "root",
  task: "root",
  paragraph: "root",
  header: "root",
  table: "root",
  data: "root",
  "space-lua": "system",
  "space-style": "system",
  relation: "edge",
  tag: "index",
  anchor: "index",
  "aspiring-page": "index",
  "ambiguous-link": "index",
  identity: "index",
};

/** Kept queryable for compatibility, but no longer listed or documented: `link` is a view over `relation` */
export const DEPRECATED_VIEW_TAGS: readonly string[] = ["link"];

export function builtinTagKind(tag: string): TagKind | undefined {
  return Object.hasOwn(BUILTIN_TAG_KINDS, tag)
    ? BUILTIN_TAG_KINDS[tag]
    : undefined;
}

export function isBuiltinTag(tag: string): boolean {
  return (
    builtinTagKind(tag) !== undefined || DEPRECATED_VIEW_TAGS.includes(tag)
  );
}

export function isBuiltinRootTag(tag: string): boolean {
  return builtinTagKind(tag) === "root";
}

export function builtinTagsOfKind(kind: TagKind): string[] {
  return Object.keys(BUILTIN_TAG_KINDS).filter(
    (t) => BUILTIN_TAG_KINDS[t] === kind,
  );
}
