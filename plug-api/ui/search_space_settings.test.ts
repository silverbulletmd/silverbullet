import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import type { IndexReport, SpaceSearchInfo } from "../types/search_admin.ts";
import {
  type SpaceSearchSettingsViewProps,
  SpaceSearchSettingsView,
} from "./search_space_settings.tsx";

const ready: IndexReport = {
  kind: "fullText",
  state: "ready",
  catchUp: null,
  pages: 12,
  bytes: 4096,
  memory: false,
  buildSecs: 1,
};
const waiting: IndexReport = {
  kind: "semantic",
  state: "waiting",
  pages: null,
  bytes: null,
  memory: false,
  buildSecs: null,
};

function info(over: Partial<SpaceSearchInfo> = {}): SpaceSearchInfo {
  return {
    semanticChoice: null,
    semantic: "on",
    pages: 12,
    indexes: [ready],
    offer: { offByDefault: null, warning: null },
    ...over,
  };
}

const copy = {
  noModel: "Choose a model first.",
  default: "On by default.",
  loading: "Asking the server.",
  heading: "Indexes",
  unavailable: "No search here.",
};

function view(
  over: Partial<SpaceSearchSettingsViewProps<SpaceSearchInfo>> = {},
): string {
  return render(
    h(SpaceSearchSettingsView<SpaceSearchInfo>, {
      info: info(),
      error: "",
      showIndexes: true,
      rebuilding: false,
      onRebuild: () => {},
      saved: null,
      value: null,
      onChange: () => {},
      copy,
      ...over,
    }),
  );
}

const rebuildButton = /<button[^>]*>Rebuild search index/;
const disabledRebuild = /<button[^>]*disabled[^>]*>Rebuild search index/;
const disabledBox = /<input(?=[^>]*\bdisabled)[^>]*type="checkbox"/;

test("while loading the box is disabled with the host's loading help", () => {
  const html = view({ info: undefined });
  expect(html).toContain("Semantic search");
  expect(html).toContain("Asking the server.");
  expect(html).toMatch(disabledBox);
  expect(html).toContain("Loading…");
  expect(html).not.toMatch(rebuildButton);
});

test("a space's indexes show under the host's heading with Rebuild", () => {
  const html = view();
  expect(html).toContain("<h3>Indexes</h3>");
  expect(html).toContain("Full-text index");
  expect(html).toContain("On by default.");
  expect(html).toMatch(rebuildButton);
  expect(html).not.toMatch(disabledRebuild);
  expect(view({ info: info({ indexes: [ready, waiting] }) })).toMatch(
    disabledRebuild,
  );
  expect(view({ rebuilding: true })).toMatch(disabledRebuild);
});

test("the server's off-by-default note and warning show as given, the box enabled", () => {
  const offByDefault =
    "This space has 12,340 pages, more than 5,000, so semantic search is off by default. Turn it on to build it anyway; the first build can take a long time.";
  const html = view({
    info: info({
      semantic: "offTooLarge",
      offer: { offByDefault, warning: null },
    }),
  });
  expect(html).toContain(offByDefault);
  expect(html).not.toMatch(disabledBox);
  expect(
    view({
      info: info({ offer: { offByDefault: null, warning: "Large space." } }),
    }),
  ).toContain("Large space.");
  expect(view({ info: info({ semantic: "noModel" }) })).toContain(
    "Choose a model first.",
  );
});

test("a space without indexes has nothing to rebuild", () => {
  const html = view({ info: info({ indexes: [] }) });
  expect(html).toContain("No search here.");
  expect(html).not.toMatch(rebuildButton);
});

test("a host's note replaces the indexes and keeps Rebuild", () => {
  const html = view({
    info: info({ indexes: [] }),
    note: () => "Open it first.",
  });
  expect(html).toContain("Open it first.");
  expect(html).not.toContain("No search here.");
  expect(html).toMatch(rebuildButton);
  expect(html).not.toMatch(disabledRebuild);
});

test("without indexes shown only the box renders", () => {
  const html = view({ showIndexes: false });
  expect(html).toContain("Semantic search");
  expect(html).not.toContain("<h3>");
  expect(html).not.toMatch(rebuildButton);
});
