import { debug, editor } from "$sb/syscalls.ts";

export async function cleanCommand() {
  if (
    !await editor.confirm(
      "This will remove all your locally cached data and authentication cookies. Are you sure?",
    )
  ) {
    return;
  }
  await editor.flashNotification("Now wiping all state and logging out...");
  await debug.cleanup();
  await editor.openUrl("/.auth?logout", true);
}
