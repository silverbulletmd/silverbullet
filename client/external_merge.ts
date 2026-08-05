import { ChangeSet } from "@codemirror/state";
import { diffAndPrepareChanges } from "./codemirror/cm_util.ts";

/**
 * Three-way merge for externally-changed page content.
 *
 * `base` is the last known on-disk text (tracked by ContentManager), `disk`
 * is the new on-disk text, and `current` is the editor doc (possibly holding
 * unsaved local edits relative to base). Both diffs are taken against base;
 * the external change set is mapped through the local one so local edits are
 * preserved. When an external and a local edit touch the same range, neither
 * is discarded: both fragments land in the result, concatenated in position
 * order (see the "does not silently drop local content..." test in
 * external_merge.test.ts for the exact shape) rather than one overwriting
 * the other. The returned ChangeSet applies to `current`.
 */
export function computeExternalChanges(
  base: string,
  disk: string,
  current: string,
): ChangeSet {
  if (disk === current) {
    return ChangeSet.empty(current.length);
  }
  const external = ChangeSet.of(diffAndPrepareChanges(base, disk), base.length);
  if (current === base) {
    return external;
  }
  const local = ChangeSet.of(diffAndPrepareChanges(base, current), base.length);
  // before: true keeps a local insertion on the user's side of the merge
  // when it sits at the same position as an external edit.
  return external.map(local, true);
}
