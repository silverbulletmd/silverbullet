/** Namespace for an identity identifier. The `@` mirrors how the name is
 * written in the text, so index queries read naturally (`_.to == "@bob"`),
 * while still keeping identity ids out of the page-name keyspace that the
 * backlink/rename machinery matches on. Stored on every mention relation and
 * on every `identity` object in the index. */
export const IDENTITY_PREFIX = "@";

/** An identity is a name; this is the identifier every mention of it carries.
 * A leading `@` in the input is the prefix itself, so it is not doubled. */
export function identityId(name: string): string {
  return IDENTITY_PREFIX + name.replace(/^@/, "").toLowerCase();
}
