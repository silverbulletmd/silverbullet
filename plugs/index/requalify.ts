import {
  getNameFromPath,
  type Path,
} from "@silverbulletmd/silverbullet/lib/ref";
import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";
import {
  BasenameIndex,
  type LinkWriteFormat,
  writeLinkPath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import { config, space } from "@silverbulletmd/silverbullet/syscalls";
import { updateBacklinks } from "./refactor.ts";

/**
 * Restores the "a bare link exists iff its basename is unique" invariant after
 * a local write introduces a collision.
 *
 * Saving `bla2/Notes` when `bla/Notes` already exists would silently make every
 * bare `[[Notes]]` ambiguous, so those links are rewritten to `[[bla/Notes]]`
 * — the page they already meant. Only pre-existing pages are requalified; the
 * page just written is the newcomer.
 *
 * This fires on `page:saved`, which only covers writes made by this client:
 * sync-delivered files and bulk external changes (a `git checkout`, say) go
 * through the service worker and deliberately do not requalify, so an incoming
 * branch never leaves the working tree dirty with edits nobody authored. Those
 * collisions surface as `ambiguous-link` objects instead.
 */
export async function requalifyCollisions(pageName: string): Promise<void> {
  const lookups = await space.lookupPaths([fileName(`${pageName}.md`)]);
  const candidates = Object.values(lookups)[0]?.candidates ?? [];
  if (candidates.length < 2) {
    return;
  }

  const others = candidates
    .map((path) => path.replace(/\.md$/, ""))
    .filter((name) => name !== pageName);

  // The rewritten links honor the configured write format: with
  // `shortest-suffix` they get the shortest still-unique path suffix, with
  // the other formats the full path (the name collides, so `shortest` cannot
  // write it bare).
  const writeFormat = await config.get<LinkWriteFormat>(
    "linkWriteFormat",
    "shortest",
  );
  const index = new BasenameIndex();
  index.rebuild(candidates);

  for (const other of others) {
    const written = getNameFromPath(
      writeLinkPath(`${other}.md` as Path, writeFormat, index),
    );
    await updateBacklinks(other, other, written, true);
  }
}

export async function requalifyAfterSave(
  pageName: string,
  _meta: unknown,
  created: boolean,
) {
  if (!created) {
    return;
  }
  await requalifyCollisions(pageName);
}
