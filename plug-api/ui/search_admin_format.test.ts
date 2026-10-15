import { expect, test } from "vitest";
import {
  downloadProgress,
  formatBytes,
  indexBuildCount,
  indexesBytes,
  indexProgress,
  indexStateText,
  indexStatusWord,
  modelChangeConfirmText,
  onByDefaultText,
  rebuildConfirmText,
  removeModelConfirmText,
  searchSummaryText,
  semanticStateText,
  spaceBadgeLabel,
} from "./search_admin_format.ts";
import type { IndexReport } from "../types/search_admin.ts";

const e5 = {
  id: "multilingual-e5-small",
  displayName: "Multilingual E5 Small",
  languages: "Multilingual (about 100 languages)",
  downloadBytes: 487_724_985,
  residentBytes: 588_302_000,
  license: "MIT",
  homepage: "https://huggingface.co/intfloat/multilingual-e5-small",
  notice: "",
};
const ready = (over: Partial<IndexReport> = {}): IndexReport =>
  ({
    kind: "fullText",
    state: "ready",
    catchUp: null,
    pages: 2950,
    bytes: 41_000_000,
    memory: false,
    buildSecs: 4,
    ...over,
  }) as IndexReport;

test("bytes are decimal like the server's log lines", () => {
  expect(formatBytes(487_724_985)).toBe("488 MB");
  expect(formatBytes(41_000_000)).toBe("41 MB");
  expect(formatBytes(3_100_000)).toBe("3.1 MB");
  expect(formatBytes(820_000)).toBe("820 kB");
  expect(formatBytes(999_999)).toBe("1 MB");
  expect(formatBytes(512)).toBe("512 B");
});

test("index states read as one line", () => {
  expect(indexStateText(ready())).toBe("Ready · 2,950 pages · 41 MB");
  expect(
    indexStateText({
      ...ready(),
      state: "building",
      done: 1200,
      total: 2950,
    } as IndexReport),
  ).toBe("Building · 1,200 of 2,950 pages");
  expect(
    indexStateText({
      ...ready(),
      state: "failed",
      reason: "Disk full",
    } as IndexReport),
  ).toBe("Failed: Disk full");
  expect(
    indexStateText({
      ...ready(),
      catchUp: { done: 3, total: 40 },
    } as IndexReport),
  ).toBe("Ready · catching up 3 of 40 pages");
  expect(
    indexStateText({
      ...ready({ kind: "semantic" }),
      state: "downloading",
      done: 120_000_000,
      total: 487_724_985,
    } as IndexReport),
  ).toBe("Downloading the model · 120 MB of 488 MB");
  expect(indexStateText({ ...ready(), state: "starting" } as IndexReport)).toBe(
    "Starting…",
  );
  expect(indexStateText({ ...ready(), state: "waiting" } as IndexReport)).toBe(
    "Waiting to build",
  );
  expect(
    indexProgress({ ...ready(), state: "waiting" } as IndexReport),
  ).toBeNull();
  expect(indexProgress(ready())).toBeNull();
  expect(
    indexProgress({
      ...ready(),
      state: "building",
      done: 10,
      total: 40,
    } as IndexReport),
  ).toBe(0.25);
});

test("the rebuild confirmation just asks", () => {
  expect(rebuildConfirmText()).toBe(
    "Are you sure you want to rebuild the search index?",
  );
});

test("changing the model only asks when spaces use it", () => {
  expect(modelChangeConfirmText(null, e5, 0)).toBeNull();
  expect(modelChangeConfirmText(e5, null, 2)).toContain("2 spaces");
  expect(modelChangeConfirmText(null, e5, 1)).toContain("488 MB");
});

test("semantic states explain why semantic search is off", () => {
  expect(semanticStateText("on")).toBeNull();
  expect(semanticStateText("offByChoice")).toBe("Off by choice");
  expect(semanticStateText("offTooLarge")).toBe("Off: over 5,000 pages");
  expect(semanticStateText("noModel")).toBe("Off: no search model");
});

test("the space list badge names a building or failed search index", () => {
  expect(spaceBadgeLabel("building")).toBe("Indexing");
  expect(spaceBadgeLabel("failed")).toBe("Search failed");
  expect(spaceBadgeLabel(null)).toBeNull();
});

test("the remove confirmation names the model, its size and where it is", () => {
  const stored = {
    id: e5.id,
    displayName: e5.displayName,
    bytes: 487_724_985,
    complete: true,
    active: false,
  };
  expect(removeModelConfirmText(stored, "this computer")).toBe(
    "Remove Multilingual E5 Small (488 MB) from this computer? You can download it again later.",
  );
});

test("index sizes add up, and progress is clamped", () => {
  expect(indexesBytes([])).toBeNull();
  expect(indexesBytes([ready({ bytes: null })])).toBeNull();
  expect(
    indexesBytes([ready(), ready({ kind: "semantic", bytes: 4_000_000 })]),
  ).toBe(45_000_000);
  expect(downloadProgress({ state: "downloading", done: 5, total: 4 })).toBe(1);
  expect(downloadProgress({ state: "downloading", done: 5, total: 0 })).toBe(0);
});

test("the summary names what each space is doing, building first", () => {
  const building = (done: number, total: number, kind = "fullText") =>
    ({
      ...ready({ kind } as Partial<IndexReport>),
      state: "building",
      done,
      total,
    }) as IndexReport;
  const state = (s: string, over: object = {}) =>
    ({ ...ready(), state: s, ...over }) as IndexReport;
  const space = (name: string, ...indexes: IndexReport[]) => ({
    name,
    indexes,
  });

  expect(
    searchSummaryText({
      a: space("Notes", building(1200, 5000)),
      b: space("Recipes", state("waiting")),
      c: space("Bikes", ready(), state("waiting", { kind: "semantic" })),
      d: space("Garden", ready()),
    }),
  ).toBe("Indexing Notes (1,200 of 5,000 pages), 2 spaces waiting");
  expect(
    searchSummaryText({ a: space("Notes", ready()), b: space("Bikes") }),
  ).toBe("All indexes up to date");
  // Nothing to report on: every space closed, or none at all.
  expect(searchSummaryText({ a: space("Notes") })).toBeNull();
  expect(searchSummaryText({})).toBeNull();
  // The index furthest from done speaks for its space.
  expect(
    searchSummaryText({
      a: space("Notes", building(900, 1000), building(10, 1000, "semantic")),
    }),
  ).toBe("Indexing Notes (10 of 1,000 pages)");
  expect(
    searchSummaryText({
      a: space(
        "Notes",
        ready(),
        state("downloading", {
          kind: "semantic",
          done: 120_000_000,
          total: 487_724_985,
        }),
      ),
      b: space(
        "Bikes",
        ready(),
        state("downloading", {
          kind: "semantic",
          done: 120_000_000,
          total: 487_724_985,
        }),
      ),
      c: space("Garden", state("starting")),
      d: space(
        "Orchard",
        state("ready", { catchUp: { done: 300, total: 2000 } }),
      ),
      e: space("Recipes", state("failed", { reason: "disk full" })),
    }),
  ).toBe(
    "Downloading the search model (120 MB of 488 MB), 1 space starting, Catching up Orchard (300 of 2,000 pages), Search failed in Recipes",
  );
  expect(
    searchSummaryText({
      a: space(
        "Notes",
        building(1, 1),
        state("failed", { kind: "semantic", reason: "x" }),
      ),
      b: space("Bikes", state("failed", { reason: "y" })),
    }),
  ).toBe("Indexing Notes (1 of 1 page), Search failed in 2 spaces");
});

test("the on-by-default help names the model and where it is chosen", () => {
  expect(onByDefaultText("Multilingual E5 Small", "this server")).toBe(
    "On by default for this server's search model (Multilingual E5 Small). Turn it off to use full-text search only in this space.",
  );
});

test("the spaces table says each index's status in one word", () => {
  const as = (state: object) => ({ ...ready(), ...state }) as IndexReport;
  const building = as({ state: "building", done: 1150, total: 3920 });
  expect(indexStatusWord(ready())).toBe("Ready");
  expect(indexStatusWord(building)).toBe("Building");
  expect(indexStatusWord(as({ state: "waiting" }))).toBe("Waiting");
  expect(indexStatusWord(as({ state: "starting" }))).toBe("Waiting");
  expect(indexStatusWord(as({ state: "downloading", done: 1, total: 2 }))).toBe(
    "Waiting",
  );
  expect(
    indexStatusWord(
      ready({ catchUp: { done: 1, total: 9 } } as Partial<IndexReport>),
    ),
  ).toBe("Catching up");
  expect(indexStatusWord(as({ state: "failed", reason: "disk full" }))).toBe(
    "Failed",
  );
  expect(indexBuildCount(building)).toBe("1,150/3,920");
  expect(indexBuildCount(ready())).toBeNull();
});
