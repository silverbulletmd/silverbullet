/**
 * Finds an existing path that blocks renaming `oldPath` to `newPath`, or
 * undefined when the rename may proceed.
 *
 * Comparison is case-insensitive so renames can't collide on a case-insensitive
 * filesystem; excluding the file's own old path is what permits renaming a file
 * to a different casing of its own name. A result equal to `newPath` means the
 * target genuinely exists, anything else means it differs only in casing.
 */
export function findRenameConflict(
  existingPaths: string[],
  oldPath: string,
  newPath: string,
): string | undefined {
  const target = newPath.toLowerCase();
  return existingPaths.find(
    (path) => path !== oldPath && path.toLowerCase() === target,
  );
}

/**
 * Whether the old path may be deleted after the new one was written.
 *
 * A server-side re-case can fail (a Windows sharing violation, a symlinked
 * folder), leaving the file under its old name — where deleting that name would
 * destroy the only copy. Names differing by more than casing are distinct files
 * and need no check.
 */
export function shouldDeleteOldPath(
  oldPath: string,
  newPath: string,
  newPathExistsWithExactCasing: boolean,
): boolean {
  if (oldPath.toLowerCase() !== newPath.toLowerCase()) {
    return true;
  }
  return newPathExistsWithExactCasing;
}
