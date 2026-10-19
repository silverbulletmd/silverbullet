import { describe, expect, test } from "vitest";
import type {
  GitSyncSnapshot,
  SyncState,
} from "@silverbulletmd/silverbullet/type/revisions";
import {
  gitHeadline,
  loadActivity,
  loadOverview,
  type OverviewActivity,
  type OverviewDeps,
  showAuthors,
  topTags,
} from "./overview.ts";
import { LINKS } from "./overview_links.ts";

function fakeDeps(overrides: Partial<OverviewDeps> = {}): OverviewDeps {
  return {
    indexReady: async () => false,
    countTag: async () => 0,
    pages: async () => [],
    tasks: async () => [],
    tagRows: async () => [],
    documents: async () => [],
    activity: async () => ({ commits: [], topFiles: [], authors: [] }),
    ...overrides,
  };
}

const now = new Date(2026, 9, 19, 12, 0, 0);

describe("topTags", () => {
  test("topTags groups rows by name and sorts by count", () => {
    const rows = ["book", "book", "idea", "recipe", "book", "idea"].map(
      (name) => ({ name }),
    );
    expect(topTags(rows, 2)).toEqual({
      tags: [
        { name: "book", count: 3 },
        { name: "idea", count: 2 },
      ],
      total: 3,
    });
  });
});

describe("topTags ties", () => {
  test("equal counts sort by name ascending", () => {
    const rows = ["pear", "apple", "mango"].map((name) => ({ name }));
    expect(topTags(rows, 3).tags.map((t) => t.name)).toEqual([
      "apple",
      "mango",
      "pear",
    ]);
  });
});

describe("loadOverview", () => {
  test("loadOverview splits tasks into open and done", async () => {
    const stats = await loadOverview(
      fakeDeps({
        indexReady: async () => true,
        tasks: async () => [
          { page: "A", done: true },
          { page: "A", done: false },
          { page: "B" },
        ],
      }),
      now,
    );
    expect(stats.indexReady).toBe(true);
    expect(stats.tasksDone).toBe(1);
    expect(stats.tasksOpen).toBe(2);
  });

  test("pagesThisMonth counts pages created in the current local month", async () => {
    const stats = await loadOverview(
      fakeDeps({
        pages: async () => [
          { name: "A", created: new Date(2026, 9, 1, 8).toISOString() },
          { name: "B", created: new Date(2026, 9, 18, 8).toISOString() },
          { name: "C", created: new Date(2026, 8, 30, 23).toISOString() },
          { name: "D", created: new Date(2025, 9, 5, 8).toISOString() },
        ],
      }),
      now,
    );
    expect(stats.pages).toBe(4);
    expect(stats.pagesThisMonth).toBe(2);
  });

  test("does not wait on the activity call", async () => {
    let asked = 0;
    const stats = await loadOverview(
      fakeDeps({
        pages: async () => [{ name: "A", created: now.toISOString() }],
        activity: () => {
          asked++;
          return new Promise(() => {});
        },
      }),
      now,
    );
    expect(stats.pages).toBe(1);
    expect(asked).toBe(0);
  });

  test("empty space yields zero counts", async () => {
    const stats = await loadOverview(fakeDeps(), now);
    expect(stats.indexReady).toBe(false);
    expect(stats.pages).toBe(0);
    expect(stats.pagesThisMonth).toBe(0);
    expect(stats.tasksOpen).toBe(0);
    expect(stats.tasksDone).toBe(0);
    expect(stats.relations).toBe(0);
    expect(stats.documents).toBe(0);
    expect(stats.documentBytes).toBe(0);
    expect(stats.tags).toEqual([]);
    expect(stats.tagTotal).toBe(0);
    expect(Object.values(stats).filter(Number.isNaN)).toEqual([]);
  });

  test("rows from Library/ and Repositories/ pages are excluded from pages, tasks and tags", async () => {
    const stats = await loadOverview(
      fakeDeps({
        pages: async () => [
          { name: "Library/Std/X", created: now.toISOString() },
          { name: "Repositories/Std", created: now.toISOString() },
          { name: "Mine", created: now.toISOString() },
        ],
        tasks: async () => [
          { page: "Library/Std/X", done: false },
          { page: "Repositories/Std", done: false },
          { page: "Mine", done: true },
        ],
        tagRows: async () => [
          { name: "libtag", page: "Library/Std/X", tag: "tag" },
          { name: "repotag", page: "Repositories/Std", tag: "tag" },
          { name: "mytag", page: "Mine", tag: "tag" },
        ],
      }),
      now,
    );
    expect(stats.pages).toBe(1);
    expect(stats.pagesThisMonth).toBe(1);
    expect(stats.tasksOpen).toBe(0);
    expect(stats.tasksDone).toBe(1);
    expect(stats.tags).toEqual([{ name: "mytag", count: 1 }]);
    expect(stats.tagTotal).toBe(1);
  });

  test("non-tag objects and commented tags are not counted", async () => {
    const stats = await loadOverview(
      fakeDeps({
        tagRows: async () => [
          { name: "real", page: "A", tag: "tag" },
          { page: "A", tag: "tag" },
          { name: "para", page: "A", tag: "paragraph" },
          { name: "hidden", page: "A", tag: "tag", inComment: true },
        ],
      }),
      now,
    );
    expect(stats.tags).toEqual([{ name: "real", count: 1 }]);
    expect(stats.tagTotal).toBe(1);
  });

  test("meta tags are excluded from the top tags and the total", async () => {
    const stats = await loadOverview(
      fakeDeps({
        tagRows: async () => [
          { name: "meta", page: "A", tag: "tag" },
          { name: "meta/library/remote", page: "A", tag: "tag" },
          { name: "metadata", page: "A", tag: "tag" },
        ],
      }),
      now,
    );
    expect(stats.tags).toEqual([{ name: "metadata", count: 1 }]);
    expect(stats.tagTotal).toBe(1);
  });

  test("a tag counts once per page, not per use", async () => {
    const stats = await loadOverview(
      fakeDeps({
        tagRows: async () => [
          { name: "idea", page: "A", tag: "tag" },
          { name: "idea", page: "A", tag: "tag" },
          { name: "idea", page: "B", tag: "tag" },
          { name: "book", page: "A", tag: "tag" },
        ],
      }),
      now,
    );
    expect(stats.tags).toEqual([
      { name: "idea", count: 2 },
      { name: "book", count: 1 },
    ]);
    expect(stats.tagTotal).toBe(2);
  });
});

describe("loadActivity", () => {
  test("a failed activity call yields null", async () => {
    const activity = await loadActivity(
      fakeDeps({
        activity: async () => {
          throw Object.assign(new Error("x"), { status: 403 });
        },
      }),
      now,
    );
    expect(activity).toBeNull();
  });

  test("topFiles are page names without .md", async () => {
    const activity = await loadActivity(
      fakeDeps({
        pages: async () => [{ name: "Notes/Daily", created: "" }],
        activity: async () => ({
          commits: [],
          topFiles: [
            { path: "Notes/Daily.md", count: 5 },
            { path: "image.png", count: 2 },
          ],
          authors: [],
        }),
      }),
      now,
    );
    expect(activity?.topFiles).toEqual([{ page: "Notes/Daily", count: 5 }]);
  });

  test("activity authors pass through", async () => {
    const authors = [
      { name: "Alice", count: 2 },
      { name: "Bob", count: 1 },
    ];
    const withAuthors = await loadActivity(
      fakeDeps({
        activity: async () => ({ commits: [], topFiles: [], authors }),
      }),
      now,
    );
    expect(withAuthors?.authors).toEqual(authors);
  });

  test("most edited leaves out pages that no longer exist", async () => {
    const activity = await loadActivity(
      fakeDeps({
        pages: async () => [{ name: "Kept", created: "" }],
        activity: async () => ({
          commits: [],
          topFiles: [
            { path: "Deleted.md", count: 9 },
            { path: "Kept.md", count: 3 },
          ],
          authors: [],
        }),
      }),
      now,
    );
    expect(activity?.topFiles).toEqual([{ page: "Kept", count: 3 }]);
  });
});

describe("gitHeadline", () => {
  const snapshot = (
    sync: SyncState,
    over: Partial<GitSyncSnapshot> = {},
  ): GitSyncSnapshot => ({
    sync,
    lastAttempt: null,
    lastSuccess: null,
    version: 1,
    enabled: true,
    paused: false,
    pending: 3,
    incoming: null,
    ...over,
  });

  test("a sync error wins over the pending count", () => {
    expect(
      gitHeadline(snapshot({ state: "error", kind: "network" }), 0),
    ).toEqual({ text: "Sync failed", tone: "danger" });
  });

  test("conflicted counts the conflicts and links to Health", () => {
    const conflicted = snapshot({ state: "conflicted", paths: ["a.md"] });
    expect(gitHeadline(conflicted, 2)).toEqual({
      text: "2 conflicted",
      tone: "danger",
      to: LINKS.health,
    });
    expect(gitHeadline(conflicted, undefined).text).toBe("1 conflicted");
  });

  test("paused and syncing", () => {
    expect(
      gitHeadline(snapshot({ state: "paused", reason: "manual" }), 0),
    ).toEqual({ text: "Paused", tone: "warning" });
    expect(
      gitHeadline(snapshot({ state: "idle" }, { paused: true }), 0).text,
    ).toBe("Paused");
    expect(gitHeadline(snapshot({ state: "syncing" }), 0)).toEqual({
      text: "Syncing…",
    });
  });

  test("idle shows pending, or up to date", () => {
    expect(gitHeadline(snapshot({ state: "idle" }), 0)).toEqual({
      text: "3 pending",
    });
    expect(gitHeadline(snapshot({ state: "idle" }, { pending: 0 }), 0)).toEqual(
      { text: "Up to date" },
    );
  });
});

describe("showAuthors", () => {
  const withAuthors = (n: number) =>
    ({
      authors: Array.from({ length: n }, (_, i) => ({
        name: `Person ${i}`,
        count: 1,
      })),
    }) as OverviewActivity;

  test("needs an activity with at least two authors", () => {
    expect(showAuthors(null)).toBe(false);
    expect(showAuthors(withAuthors(0))).toBe(false);
    expect(showAuthors(withAuthors(1))).toBe(false);
    expect(showAuthors(withAuthors(2))).toBe(true);
  });
});
