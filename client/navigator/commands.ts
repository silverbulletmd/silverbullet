import { editor, events, space } from "@silverbulletmd/silverbullet/syscalls";
import type { CommandHook } from "../plugos/hooks/command.ts";
import { openCommand } from "./navigator.ts";
import { REVISIONS_CHANGED_EVENT } from "./views/revisions.ts";

/** The built-in navigator views that come with a command of their own. */
export function registerNavigatorCommands(
  hook: CommandHook,
  revisionsEnabled: boolean,
): void {
  hook.registerCommand({
    name: "Navigate: Tree",
    key: ["Ctrl-o", "Ctrl-Shift-o"],
    mac: ["Cmd-o", "Cmd-Shift-o"],
    menu: { location: "view", group: "1_views", order: 4, label: "Tree" },
    run: openCommand("std.spaceTree"),
  });
  if (revisionsEnabled) {
    hook.registerCommand({
      name: "Revision: Page History",
      requireEditor: "page",
      menu: {
        location: "space",
        group: "1_revisions",
        order: 1,
        label: "Page History",
      },
      run: openCommand("std.pageHistory"),
    });
    hook.registerCommand({
      name: "Revision: Space History",
      menu: {
        location: "space",
        group: "1_revisions",
        order: 2,
        label: "Space History",
      },
      run: openCommand("std.spaceLog"),
    });
    hook.registerCommand({
      name: "Revision: Create snapshot",
      requireMode: "rw",
      menu: {
        location: "space",
        group: "1_revisions",
        order: 3,
        label: "Create Snapshot",
      },
      run: createSnapshot,
    });
  }
}

/**
 * Registered whenever revisions are enabled, not only for a space the boot
 * config calls managed: a synced App space is advertised as unmanaged (its
 * history lives on the remote, which may well be managed), so the server's
 * own answer is the only reliable one. An unmanaged space says so.
 */
async function createSnapshot(): Promise<void> {
  let committed: boolean;
  try {
    committed = await space.createRevisionSnapshot();
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
    return;
  }
  await editor.flashNotification(
    committed ? "Snapshot created" : "Nothing to snapshot",
  );
  await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
}
