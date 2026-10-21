import { space, system } from "@silverbulletmd/silverbullet/syscalls";
import type {
  GitSyncSnapshot,
  SpaceActivity,
} from "@silverbulletmd/silverbullet/type/revisions";
import type { Client } from "../../client.ts";
import { LuaEnv } from "../../space_lua/runtime.ts";
import { isUserPage } from "../../user_pages.ts";
import { styleStatus } from "../styles/styles.ts";
import {
  ACTIVITY_DAYS,
  type ActivityDay,
  activityDays,
  editsLast7Days,
} from "./activity.ts";
import { LINKS, type OverviewLink } from "./overview_links.ts";

export type TagCount = { name: string; count: number };

export type OverviewActivity = {
  days: ActivityDay[];
  last7Days: number;
  topFiles: { page: string; count: number }[];
  authors: { name: string; count: number }[];
};

export type OverviewStats = {
  indexReady: boolean;
  pages: number;
  pagesThisMonth: number;
  tasksOpen: number;
  tasksDone: number;
  relations: number;
  documents: number;
  documentBytes: number;
  tags: TagCount[];
  tagTotal: number;
};

export type TagRow = {
  name?: string;
  page: string;
  tag?: string;
  inComment?: boolean;
};

export type OverviewDeps = {
  indexReady: () => Promise<boolean>;
  countTag: (tag: string) => Promise<number>;
  pages: () => Promise<{ name: string; created: string }[]>;
  tasks: () => Promise<{ page: string; done?: boolean }[]>;
  tagRows: () => Promise<TagRow[]>;
  documents: () => Promise<{ size: number }[]>;
  activity: (since: number, filesSince: number) => Promise<SpaceActivity>;
};

const TOP_TAGS = 6;
const TOP_FILES_DAYS = 30;
const DAY_SECONDS = 86400;

// meta and meta/* tags mark library and repository pages, not the user's topics
const isSystemTag = (name: string) =>
  name === "meta" || name.startsWith("meta/");

// A one-row list says nothing in a single-user space
export const showAuthors = (
  activity: OverviewActivity | null,
): activity is OverviewActivity => !!activity && activity.authors.length >= 2;

export function topTags(
  rows: { name: string }[],
  n: number,
): { tags: TagCount[]; total: number } {
  const counts = new Map<string, number>();
  for (const { name } of rows) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const all = [...counts].map(([name, count]) => ({ name, count }));
  all.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tags: all.slice(0, n), total: all.length };
}

/** Index-backed counts only, no network, so it's cheap to re-run on index events. */
export async function loadOverview(
  deps: OverviewDeps,
  now: Date,
): Promise<OverviewStats> {
  const [indexReady, pages, tasks, relations, tagRows, documents] =
    await Promise.all([
      deps.indexReady(),
      deps.pages(),
      deps.tasks(),
      deps.countTag("relation"),
      deps.tagRows(),
      deps.documents(),
    ]);

  const userPages = pages.filter((p) => isUserPage(p.name));
  const pagesThisMonth = userPages.filter((p) => {
    const created = new Date(p.created);
    return (
      created.getFullYear() === now.getFullYear() &&
      created.getMonth() === now.getMonth()
    );
  }).length;
  const userTasks = tasks.filter((t) => isUserPage(t.page));
  const tasksDone = userTasks.filter((t) => t.done).length;
  // The "tag" collection also holds any object tagged #tag, and tags inside
  // comments. A tag counts once per page, however it is used there.
  const seen = new Set<string>();
  const liveTags: { name: string }[] = [];
  for (const r of tagRows) {
    if (
      r.tag !== "tag" ||
      typeof r.name !== "string" ||
      r.inComment ||
      !isUserPage(r.page) ||
      isSystemTag(r.name)
    ) {
      continue;
    }
    const key = JSON.stringify([r.name, r.page]);
    if (seen.has(key)) continue;
    seen.add(key);
    liveTags.push({ name: r.name });
  }
  const { tags, total } = topTags(liveTags, TOP_TAGS);

  return {
    indexReady,
    pages: userPages.length,
    pagesThisMonth,
    tasksOpen: userTasks.length - tasksDone,
    tasksDone,
    relations,
    documents: documents.length,
    documentBytes: documents.reduce((sum, d) => sum + (d.size || 0), 0),
    tags,
    tagTotal: total,
  };
}

/**
 * Edit activity from the revision history: a network call to the git log.
 * null when it fails or revisions are off.
 */
export async function loadActivity(
  deps: Pick<OverviewDeps, "activity" | "pages">,
  now: Date,
): Promise<OverviewActivity | null> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  try {
    const [result, pages] = await Promise.all([
      deps.activity(
        nowSeconds - ACTIVITY_DAYS * DAY_SECONDS,
        nowSeconds - TOP_FILES_DAYS * DAY_SECONDS,
      ),
      deps.pages(),
    ]);
    // The log still has files deleted since; there's nothing to open for those
    const existing = new Set(pages.map((p) => p.name));
    const days = activityDays(result.commits, now);
    return {
      days,
      last7Days: editsLast7Days(days),
      topFiles: result.topFiles
        .filter((f) => f.path.endsWith(".md"))
        .map((f) => ({ page: f.path.slice(0, -3), count: f.count }))
        .filter((f) => existing.has(f.page)),
      authors: result.authors,
    };
  } catch {
    return null;
  }
}

export type GitHeadline = {
  text: string;
  tone?: "danger" | "warning";
  /** Where the headline links; none when the card title already goes there */
  to?: OverviewLink;
};

/** The Git sync card's headline: a broken or busy sync state wins over the pending count. */
export function gitHeadline(
  snapshot: GitSyncSnapshot,
  conflicts: number | undefined,
): GitHeadline {
  const { sync } = snapshot;
  switch (sync?.state) {
    case "error":
      return { text: "Sync failed", tone: "danger" };
    case "conflicted":
      return {
        text: `${(conflicts ?? sync.paths.length).toLocaleString()} conflicted`,
        tone: "danger",
        to: LINKS.health,
      };
    case "paused":
      return { text: "Paused", tone: "warning" };
    case "syncing":
      return { text: "Syncing…" };
  }
  if (snapshot.paused) return { text: "Paused", tone: "warning" };
  return snapshot.pending
    ? { text: `${snapshot.pending.toLocaleString()} pending` }
    : { text: "Up to date" };
}

export function overviewDeps(client: Client): OverviewDeps {
  const rows = <T>(tag: string) =>
    client.objectIndex.queryLuaObjects<T>(new LuaEnv(), tag, {});
  return {
    indexReady: () => client.objectIndex.isIndexAvailable(),
    countTag: (tag) => client.objectIndex.countTag(tag),
    pages: () => client.space.fetchPageList(),
    tasks: () => rows<{ page: string; done?: boolean }>("task"),
    tagRows: () => rows<TagRow>("tag"),
    documents: () => client.space.fetchDocumentList(),
    activity: (since, filesSince) => space.getActivity(since, filesSince),
  };
}

export type Runtime = {
  version: string;
  scripts: number;
  scriptsFailed: number;
  styles: number;
  stylesEmpty: number;
};

export async function loadRuntime(client: Client): Promise<Runtime> {
  const scripts = client.clientSystem.spaceLuaEnv.lastLoad?.scripts ?? [];
  const styles = client.spaceStyles.lastLoad?.styles ?? [];
  return {
    version: await system.getVersion(),
    scripts: scripts.length,
    scriptsFailed: scripts.filter((s) => s.status === "failed").length,
    styles: styles.length,
    stylesEmpty: styles.filter((r) => styleStatus(r) === "empty").length,
  };
}
