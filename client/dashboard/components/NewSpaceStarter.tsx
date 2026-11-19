import { useStarterChoice } from "@silverbulletmd/silverbullet/ui";
import { useEffect, useState } from "preact/hooks";
import {
  folderHasNotes,
  kitPreviewUrl,
  listStarterKits,
  type StarterBase,
} from "../starter_kits.ts";

const FOLDER_CHECK_DELAY_MS = 300;

/** Whether `folder` already holds notes, checked against `base` after typing settles. */
export function useFolderHasNotes(
  base: StarterBase,
  active: boolean,
  folder: string,
): boolean {
  const [hasNotes, setHasNotes] = useState(false);
  useEffect(() => {
    setHasNotes(false);
    // An empty folder makes the server create a fresh one, not use the data root.
    if (!active || !folder.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      folderHasNotes(base, folder)
        .then((value) => live && setHasNotes(value))
        .catch(() => live && setHasNotes(false));
    }, FOLDER_CHECK_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [base, active, folder]);
  return hasNotes;
}

/** Starter choices for the New space form; inert when `skip` is set. */
export function useStarter(
  skip: boolean,
  folder: string,
  onUnauthorized: () => void,
) {
  const choice = useStarterChoice(!skip, async () => {
    try {
      const kits = await listStarterKits("admin");
      return kits.map((kit) => ({
        ...kit,
        previewUrl: kitPreviewUrl("admin", kit),
      }));
    } catch (e: any) {
      if (e.unauthorized) onUnauthorized();
      throw e;
    }
  });
  const [gitMode, setGitMode] = useState<"copy" | "sync">("copy");
  const hasNotes = useFolderHasNotes(
    "admin",
    !skip && choice.choice?.type === "kit",
    folder,
  );
  return { ...choice, gitMode, setGitMode, hasNotes };
}

export type StarterState = ReturnType<typeof useStarter>;

/** How a Git starter is used: copied once, or kept in sync. */
export function GitModeOptions({ starter }: { starter: StarterState }) {
  return (
    <fieldset>
      <legend>How to use it</legend>
      <label>
        <input
          type="radio"
          name="space-git-mode"
          checked={starter.gitMode === "copy"}
          onChange={() => starter.setGitMode("copy")}
        />{" "}
        Use as a starting point — copy the files once (public repositories only)
      </label>
      <label>
        <input
          type="radio"
          name="space-git-mode"
          checked={starter.gitMode === "sync"}
          onChange={() => starter.setGitMode("sync")}
        />{" "}
        Keep in sync — this space syncs with the repo from now on
      </label>
    </fieldset>
  );
}
