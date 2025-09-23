/**
 * Checks if an object is sendable across the plugos worker boundary.
 *
 * @param o - The object to check.
 * @returns `true` if the object is sendable, `false` otherwise.
 */
export function isSendable(o: any): boolean {
  try {
    structuredClone(o);
    return true;
  } catch {
    return false;
  }
}
