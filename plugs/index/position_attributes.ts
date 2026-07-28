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
