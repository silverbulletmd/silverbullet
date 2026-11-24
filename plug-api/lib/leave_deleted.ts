import { editor, space } from "../syscalls.ts";

/**
 * Moves the editor off files about to be deleted (`gone` says which paths),
 * to the most recently opened page that stays, or the index page. Call it
 * before deleting, so an editor still showing a page can't save it back.
 */
export async function leaveBeforeDeleting(
  gone: (path: string) => boolean,
): Promise<void> {
  if (!gone(await editor.getCurrentPath())) return;
  const [recent, pages] = await Promise.all([
    editor.getRecentlyOpenedPages(),
    space.listPages(),
  ]);
  const existing = new Set(pages.map(({ name }) => name));
  const next = recent.find(
    ({ name }) => existing.has(name) && !gone(`${name}.md`),
  );
  await editor.navigate(next?.name ?? "");
}
