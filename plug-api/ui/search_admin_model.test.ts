import { expect, test } from "vitest";
import {
  canRebuild,
  indexesBusy,
  indexPhase,
  modelActive,
  overviewActive,
  overviewPollMs,
  semanticToggle,
  spaceBadge,
  spaceRowRank,
} from "./search_admin_model.ts";
import type {
  IndexReport,
  SearchOverview,
  SpaceSearchInfo,
  SpaceSearchSummary,
} from "../types/search_admin.ts";

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
const semantic = (state: object) =>
  ({ ...ready({ kind: "semantic" }), ...state }) as IndexReport;
const starting = semantic({ state: "starting" });
const waiting = semantic({ state: "waiting" });
const downloading = semantic({ state: "downloading", done: 1, total: 9 });
const building = semantic({ state: "building", done: 1, total: 3 });
const catchingUp = ready({
  catchUp: { done: 1, total: 900 },
} as Partial<IndexReport>);
const failed = semantic({ state: "failed", reason: "disk full" });

test("each index state has one phase", () => {
  expect(indexPhase(ready())).toBe("ready");
  expect(indexPhase(catchingUp)).toBe("catchingUp");
  expect(indexPhase(starting)).toBe("preparing");
  expect(indexPhase(downloading)).toBe("preparing");
  expect(indexPhase(waiting)).toBe("building");
  expect(indexPhase(building)).toBe("building");
  expect(indexPhase(failed)).toBe("failed");
});

test("the badge is the worst phase; a catch-up keeps Ready", () => {
  expect(spaceBadge([])).toBeNull();
  expect(spaceBadge([ready()])).toBeNull();
  expect(spaceBadge([ready(), catchingUp])).toBeNull();
  for (const index of [starting, waiting, downloading, building]) {
    expect(spaceBadge([ready(), index])).toBe("building");
  }
  expect(spaceBadge([building, failed])).toBe("failed");
});

test("an index starting, building or catching up is worth polling", () => {
  expect(indexesBusy([ready()])).toBe(false);
  expect(indexesBusy([ready(), failed])).toBe(false);
  for (const index of [starting, waiting, downloading, building, catchingUp]) {
    expect(indexesBusy([ready(), index])).toBe(true);
  }
});

test("a rebuild needs indexes, none building or waiting to", () => {
  expect(canRebuild([])).toBe(false);
  expect(canRebuild([ready()])).toBe(true);
  expect(canRebuild([ready(), waiting])).toBe(false);
  expect(canRebuild([building])).toBe(false);
  for (const index of [starting, downloading, catchingUp, failed]) {
    expect(canRebuild([ready(), index])).toBe(true);
  }
});

function overview(over: Partial<SearchOverview>): SearchOverview {
  return {
    model: "multilingual-e5-small",
    catalog: [],
    download: { state: "ready" },
    stored: [],
    spaces: {},
    ...over,
  };
}

function summary(indexes: IndexReport[]): SpaceSearchSummary {
  return {
    name: "Garden",
    semanticChoice: null,
    semantic: "on",
    pages: 3,
    indexes,
  };
}

test("the overview polls while a space's index changes, not while one has failed", () => {
  const with_ = (indexes: IndexReport[]) =>
    overview({ spaces: { g: summary(indexes) } });
  expect(overviewActive(with_([ready()]))).toBe(false);
  expect(overviewActive(with_([building]))).toBe(true);
  expect(overviewActive(with_([catchingUp]))).toBe(true);
  expect(overviewActive(with_([failed]))).toBe(false);
  expect(overviewPollMs(with_([building]))).toBe(2000);
  expect(overviewPollMs(with_([ready()]))).toBeNull();
  expect(overviewPollMs(undefined)).toBeNull();
});

test("the model polls while it downloads or is about to", () => {
  expect(
    modelActive(
      overview({ download: { state: "downloading", done: 1, total: 9 } }),
    ),
  ).toBe(true);
  expect(modelActive(overview({ download: { state: "missing" } }))).toBe(true);
  expect(overviewActive(overview({ download: { state: "missing" } }))).toBe(
    true,
  );
  expect(modelActive(overview({ model: null, download: null }))).toBe(false);
  expect(
    modelActive(
      overview({ download: { state: "failed", message: "offline" } }),
    ),
  ).toBe(false);
});

type Info = Pick<SpaceSearchInfo, "semanticChoice" | "semantic" | "offer">;
const info = (over: Partial<Info> = {}): Info => ({
  semanticChoice: null,
  semantic: "on",
  offer: { offByDefault: null, warning: null },
  ...over,
});
const offByDefault =
  "This space has 12,340 pages, more than 5,000, so semantic search is off by default.";
const warning = "This space has more pages than semantic search is tuned for.";

test("until its info arrives the box shows the saved choice, disabled", () => {
  const loading = (saved: boolean | null) =>
    semanticToggle({ saved, value: saved, info: undefined });
  expect(loading(null)).toMatchObject({
    checked: true,
    disabled: true,
    help: "loading",
  });
  expect(loading(false)).toMatchObject({ checked: false, disabled: true });
  // Info from before a save counts as not arrived.
  expect(
    semanticToggle({
      saved: null,
      value: null,
      info: info({ semanticChoice: false, semantic: "offByChoice" }),
    }),
  ).toMatchObject({ checked: true, disabled: true, help: "loading" });
});

test("the box shows whether the space runs semantic search as saved", () => {
  const shown = (over: Partial<Info>, saved: boolean | null = null) =>
    semanticToggle({ saved, value: saved, info: info({ ...over }) });
  expect(shown({})).toMatchObject({
    checked: true,
    disabled: false,
    help: "default",
  });
  expect(
    shown({ semanticChoice: false, semantic: "offByChoice" }, false),
  ).toMatchObject({ checked: false, disabled: false, help: "default" });
  expect(
    shown({
      semantic: "offTooLarge",
      offer: { offByDefault, warning: null },
    }),
  ).toMatchObject({ checked: false, disabled: false, help: "offByDefault" });
});

test("a space off by default for its size can be turned on, and keeps the note once checked", () => {
  const large = info({
    semantic: "offTooLarge",
    offer: { offByDefault, warning: null },
  });
  const unchecked = semanticToggle({ saved: null, value: null, info: large });
  expect(unchecked.choose(true)).toBe(true);
  expect(
    semanticToggle({ saved: null, value: true, info: large }),
  ).toMatchObject({ checked: true, disabled: false, help: "offByDefault" });
  expect(unchecked.choose(false)).toBe(null);
  const optedOut = semanticToggle({
    saved: false,
    value: false,
    info: info({
      semanticChoice: false,
      semantic: "offByChoice",
      offer: { offByDefault, warning: null },
    }),
  });
  expect(optedOut).toMatchObject({ checked: false, disabled: false });
  expect(optedOut.choose(true)).toBe(true);
});

test("without a model the model help comes first; large or not, a checked box can be unchecked", () => {
  expect(
    semanticToggle({
      saved: null,
      value: null,
      info: info({
        semantic: "noModel",
        offer: { offByDefault, warning: null },
      }),
    }),
  ).toMatchObject({ checked: false, disabled: true, help: "noModel" });
  // Checked by hand, not saved yet.
  expect(
    semanticToggle({
      saved: false,
      value: null,
      info: info({
        semanticChoice: false,
        semantic: "noModel",
      }),
    }),
  ).toMatchObject({ checked: true, disabled: false, help: "noModel" });
  expect(
    semanticToggle({
      saved: false,
      value: null,
      info: info({
        semanticChoice: false,
        semantic: "offByChoice",
        offer: { offByDefault, warning: null },
      }),
    }),
  ).toMatchObject({ checked: true, disabled: false, help: "offByDefault" });
});

test("a space on above the limit keeps the box, with the server's warning", () => {
  const on = info({ offer: { offByDefault: null, warning } });
  expect(semanticToggle({ saved: null, value: null, info: on })).toMatchObject({
    checked: true,
    disabled: false,
    help: "warning",
  });
  // Unchecked but not saved yet: it can still be checked again.
  expect(semanticToggle({ saved: null, value: false, info: on })).toMatchObject(
    { checked: false, disabled: false, help: "warning" },
  );
});

test("unchecking stores false, checking null, and the saved state the saved choice", () => {
  const on = semanticToggle({
    saved: true,
    value: true,
    info: info({ semanticChoice: true }),
  });
  expect(on.choose(false)).toBe(false);
  expect(on.choose(true)).toBe(true);
  const off = semanticToggle({
    saved: false,
    value: false,
    info: info({ semanticChoice: false, semantic: "offByChoice" }),
  });
  expect(off.choose(true)).toBeNull();
  expect(off.choose(false)).toBe(false);
  const following = semanticToggle({ saved: null, value: null, info: info() });
  expect(following.choose(false)).toBe(false);
  expect(following.choose(true)).toBeNull();
});

test("active spaces sort first, then open ones, then closed ones", () => {
  const as = (state: object) => ({ ...ready(), ...state }) as IndexReport;
  expect(spaceRowRank([ready(), as({ state: "waiting" })], false)).toBe(0);
  expect(spaceRowRank([as({ state: "failed", reason: "x" })], false)).toBe(0);
  expect(
    spaceRowRank(
      [ready({ catchUp: { done: 1, total: 9 } } as Partial<IndexReport>)],
      false,
    ),
  ).toBe(0);
  expect(spaceRowRank([ready()], false)).toBe(1);
  expect(spaceRowRank([], false)).toBe(1);
  expect(spaceRowRank([], true)).toBe(2);
});
