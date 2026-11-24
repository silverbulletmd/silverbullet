/**
 * The folder half of sync. Folders only exist or don't, so a three-way merge
 * against the folders both sides had after the last sync (`known`) settles
 * them: a folder on one side only was created there if `known` lacks it, and
 * deleted on the other side if `known` has it. A deletion only goes through
 * on an empty folder; anything added to it in the meantime wins, and the
 * folder comes back.
 *
 * Desktop's sync engine has the same pass in Rust
 * (crates/desktop-services/src/sync/folders.rs).
 */

import {
  folderNotEmptyError,
  notFoundError,
} from "@silverbulletmd/silverbullet/constants";
import type { SpacePrimitives } from "./space_primitives.ts";

export type FolderSide = "primary" | "secondary";

export type FolderPlan = {
  /** Folders to create, on the side that lacks them, shallowest first. */
  creates: { on: FolderSide; path: string }[];
  /** Folders to delete, on the side that still has them, deepest first. */
  deletes: { on: FolderSide; path: string }[];
  /** Folders on both sides already. */
  present: string[];
  /** Known folders now gone from both sides. */
  gone: string[];
};

const depth = (path: string) => path.split("/").length;
const other = (side: FolderSide): FolderSide =>
  side === "primary" ? "secondary" : "primary";

export function planFolderSync(
  known: ReadonlySet<string>,
  primary: ReadonlySet<string>,
  secondary: ReadonlySet<string>,
): FolderPlan {
  const plan: FolderPlan = { creates: [], deletes: [], present: [], gone: [] };
  const paths = [...new Set([...known, ...primary, ...secondary])].sort(
    (a, b) => depth(a) - depth(b),
  );
  for (const path of paths) {
    const inPrimary = primary.has(path);
    const inSecondary = secondary.has(path);
    if (inPrimary && inSecondary) {
      plan.present.push(path);
    } else if (!inPrimary && !inSecondary) {
      plan.gone.push(path);
    } else if (!known.has(path)) {
      plan.creates.push({ on: inPrimary ? "secondary" : "primary", path });
    } else {
      plan.deletes.push({ on: inPrimary ? "primary" : "secondary", path });
    }
  }
  plan.deletes.reverse();
  return plan;
}

/**
 * Brings both sides' folders in line and updates `known` to match. Runs
 * after the file pass, so folders that pass filled aren't taken for
 * deletions. The lists come from listings taken before that pass, so may
 * lack folders it created; creating is idempotent and a deletion that finds
 * content restores the folder, so that's harmless. Either list missing means
 * that side keeps no folders: then nothing is synced and `known` is
 * forgotten, so the first pass once both do can only create.
 * @returns number of operations performed
 */
export async function syncFolders(
  known: Set<string>,
  spaces: Record<FolderSide, SpacePrimitives>,
  primaryList: string[] | undefined,
  secondaryList: string[] | undefined,
): Promise<number> {
  if (!primaryList || !secondaryList) {
    known.clear();
    return 0;
  }
  const plan = planFolderSync(
    known,
    new Set(primaryList),
    new Set(secondaryList),
  );
  for (const path of plan.present) known.add(path);
  for (const path of plan.gone) known.delete(path);

  for (const { on, path } of plan.creates) {
    console.log("[sync]", "New folder, creating on", on, path);
    await spaces[on].createFolder(path);
    known.add(path);
  }
  for (const { on, path } of plan.deletes) {
    console.log("[sync]", "Folder deleted, deleting on", on, path);
    try {
      await spaces[on].deleteFolder(path);
      known.delete(path);
    } catch (e: any) {
      if (e.message === notFoundError.message) {
        known.delete(path);
      } else if (e.message === folderNotEmptyError.message) {
        console.log("[sync]", "Deleted folder not empty, restoring", path);
        await spaces[other(on)].createFolder(path);
      } else {
        throw e;
      }
    }
  }
  return plan.creates.length + plan.deletes.length;
}
