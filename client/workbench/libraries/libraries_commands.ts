import type { MenuPlacement } from "@silverbulletmd/silverbullet/type/manifest";
import type { LibrariesFocus } from "./libraries_model.ts";

export type LibraryCommand = {
  name: string;
  focus: LibrariesFocus;
  /** "rw" for the commands that change the space */
  requireMode?: "rw";
  menu?: MenuPlacement;
  menuMac?: MenuPlacement;
};

export const LIBRARY_COMMANDS: LibraryCommand[] = [
  {
    name: "Libraries: Manager",
    focus: "manager",
  },
  { name: "Library: Manager", focus: "manager" },
  { name: "Library: Install", focus: "install", requireMode: "rw" },
  {
    name: "Library: Add Repository",
    focus: "addRepository",
    requireMode: "rw",
  },
  { name: "Library: Update All", focus: "updateAll", requireMode: "rw" },
  {
    name: "Library: Update All Repositories",
    focus: "updateAllRepositories",
    requireMode: "rw",
  },
];

/** Backs the hidden `Library: Update` command, called with `{ name }`. */
export async function runLibraryUpdate(
  args: unknown[] | undefined,
  update: (name: string) => Promise<{ changed: boolean }>,
  notify: (message: string, type: "info" | "error") => void,
): Promise<void> {
  const name = (args?.[0] as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string") {
    notify("Library: Update needs a library name", "error");
    return;
  }
  try {
    const { changed } = await update(name);
    notify(
      changed ? `Updated ${name}` : `${name} is already up to date`,
      "info",
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), "error");
  }
}
