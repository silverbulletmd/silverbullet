import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";
import { index, mq, space } from "@silverbulletmd/silverbullet/syscalls";
import { getTextualBackRelations } from "./relation.ts";

function toName(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

const pendingBasenames = new Set<string>();
const pendingPaths = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Finds the pages to re-index now that files carrying these basenames — the
 * files at these exact paths — appeared or disappeared. Exported for tests;
 * the timer-driven flush below is the production caller.
 */
export async function collectPagesToReindex(
  basenames: string[],
  paths: string[],
): Promise<Set<string>> {
  // Every file that currently answers to one of these names: a bare link to any
  // of them may now land somewhere else.
  const lookups = await space.lookupPaths(basenames);
  const targets = new Set<string>();
  for (const basename of basenames) {
    targets.add(toName(basename));
    for (const candidate of lookups[basename]?.candidates ?? []) {
      targets.add(toName(candidate));
    }
  }
  // Relations store *resolved* paths, so the affected file's own path is a
  // target in its own right: after a delete, or the delete half of a
  // folder-to-folder move, no candidate lookup returns it anymore — yet that
  // is exactly the name the stale relations point at.
  for (const path of paths) {
    targets.add(toName(path));
  }

  const pages = new Set<string>();
  for (const target of targets) {
    for (const relation of await getTextualBackRelations(target)) {
      pages.add(relation.page);
    }
  }

  // Links that resolved to nothing may have a target now.
  const wanted = new Set(basenames.map((b) => toName(b).toLowerCase()));
  const aspiring = await index.queryLuaObjects<any>("aspiring-page", {});
  for (const record of aspiring) {
    if (wanted.has(toName(fileName(String(record.name))).toLowerCase())) {
      pages.add(record.page);
    }
  }
  return pages;
}

/**
 * Re-indexes the pages whose links may have changed meaning now that files
 * carrying these names have appeared or disappeared.
 *
 * Link resolution is stateful: `[[Notes]]` means whichever file currently
 * carries that name. So adding or removing a file silently changes what links
 * *elsewhere* point at — and those pages are never re-indexed on their own,
 * because their bytes did not change. Renaming a page into a folder is the
 * visible case: the bare links to it keep working, but every relation still
 * names the old page and its linked mentions vanish.
 *
 * Driven by file events rather than by the operations that cause them: an event
 * means the client's file listing has already caught up, which is not true
 * inside a compound operation like a rename (see `EventedSpacePrimitives`,
 * which suppresses events and defers `fetchFileList` while one is in flight).
 */
async function flushPending(): Promise<void> {
  const basenames = [...pendingBasenames];
  const paths = [...pendingPaths];
  pendingBasenames.clear();
  pendingPaths.clear();
  if (basenames.length === 0) {
    return;
  }

  const pages = await collectPagesToReindex(basenames, paths);
  if (pages.size === 0) {
    return;
  }

  await mq.batchSend(
    "indexQueue",
    [...pages].map((page) => `${page}.md`),
  );
}

/**
 * Buffered because a sync, a space load, or a `git checkout` delivers files in
 * bursts, and every arrival would otherwise trigger its own set of index
 * queries. One pass once the burst settles finds the same pages.
 */
function scheduleInvalidation(path: string) {
  pendingBasenames.add(fileName(path));
  pendingPaths.add(path);
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    flushPending().catch((e) =>
      console.error("[index] Link invalidation failed", e),
    );
  }, 500);
}

export function invalidateOnFileAppeared(
  path: string,
  oldHash: number | undefined,
) {
  // A plain edit cannot change what any link resolves to — only the arrival of
  // a file can, which is what an absent previous hash means.
  if (oldHash === undefined) {
    scheduleInvalidation(path);
  }
}

export function invalidateOnFileDeleted(path: string) {
  scheduleInvalidation(path);
}
