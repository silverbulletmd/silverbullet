import type { MenuPlacement } from "@silverbulletmd/silverbullet/type/manifest";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import {
  type LibrariesFocus,
  requestLibrariesFocus,
  takeLibrariesFocus,
} from "./libraries_focus.ts";

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
    menuMac: {
      location: "app",
      group: "4_prefs",
      order: 3,
      label: "Libraries...",
    },
    menu: {
      location: "file",
      group: "2_prefs",
      order: 3,
      label: "Libraries...",
    },
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

/**
 * The request goes first: the Workbench may be closed, and the Libraries tab
 * takes the pending request when it shows.
 */
export async function runLibraryCommand(
  focus: LibrariesFocus,
  showView: (view: string, opts: { segment: string }) => Promise<unknown>,
): Promise<false> {
  requestLibrariesFocus(focus);
  try {
    await showView(WORKBENCH_VIEW, { segment: "Libraries" });
  } catch (e) {
    // Nothing will take it; don't let it run on some later show
    takeLibrariesFocus();
    throw e;
  }
  // The panel took focus; `false` stops the palette handing it back to the editor
  return false;
}
