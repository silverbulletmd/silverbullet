/**
 * Internally used attribute names that cannot be overriden by the user.
 */
const POSITION_ATTRIBUTES = ["pos", "range"];

/**
 * Returns `data` without the reserved position attributes, so it is safe to
 * merge over a synthesized object. Returns the original object untouched when
 * it carries neither, which is the overwhelmingly common case.
 */
export function stripPositionAttributes<T extends Record<string, any>>(
  data: T,
): T {
  if (!POSITION_ATTRIBUTES.some((name) => name in data)) {
    return data;
  }
  const cleaned = { ...data };
  for (const name of POSITION_ATTRIBUTES) {
    delete cleaned[name];
  }
  return cleaned;
}

/**
 * Whether `name` is a reserved position attribute (for attribute-by-attribute
 * merges).
 */
export function isPositionAttribute(name: string): boolean {
  return POSITION_ATTRIBUTES.includes(name);
}

/**
 * Attributes carrying a synthesized object's identity and indexing metadata.
 *
 * Deliberately NOT part of POSITION_ATTRIBUTES: frontmatter legitimately sets
 * `tags`, so this set only applies where a row/item object is synthesized and
 * user-supplied labels are merged onto it afterwards.
 */
const IDENTITY_ATTRIBUTES = [
  "ref",
  "tag",
  "tags",
  "itags",
  "tableref",
  "page",
  "inComment",
];

/**
 * Whether `name` would collide with a synthesized object's own identity or
 * position. Overwriting `tag` re-types the object and overwriting `ref` gives
 * it another object's identity, so a table whose column happens to be called
 * `tag` would otherwise clobber the unrelated object it now points at.
 */
export function isReservedObjectAttribute(name: string): boolean {
  return isPositionAttribute(name) || IDENTITY_ATTRIBUTES.includes(name);
}
