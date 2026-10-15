// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  api: vi.fn(),
  getSearchOverview: vi.fn(),
}));
vi.mock("../api.ts", () => ({
  ...api,
  formatApiError: (e: any) => String(e?.message ?? e),
}));

import { SpaceList } from "./SpaceList.tsx";

const spaces = [
  { id: "garden", name: "Garden", binding: { prefix: "/garden" } },
  { id: "recipes", name: "Recipes", binding: { prefix: "/recipes" } },
  { id: "bikes", name: "Bikes", binding: { prefix: "/bikes" } },
];

const states = {
  building: { state: "building", done: 1, total: 3 },
  failed: { state: "failed", reason: "disk full" },
  ready: { state: "ready", catchUp: null },
};

/** An overview whose spaces each have one index in `states[...]`. */
function overview(indexes: Record<string, keyof typeof states>) {
  return {
    model: null,
    download: null,
    spaces: Object.fromEntries(
      Object.entries(indexes).map(([id, state]) => [
        id,
        { indexes: [{ kind: "fullText", ...states[state] }] },
      ]),
    ),
  };
}

let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.append(root);
  api.api.mockReset().mockResolvedValue(spaces);
  api.getSearchOverview.mockReset();
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

async function mount(admin: boolean) {
  await act(() =>
    render(h(SpaceList, { admin, onUnauthorized: () => {} }), root),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function badges(): string[] {
  return [...root.querySelectorAll(".sb-space-search-badge")].map(
    (b) =>
      `${b.closest("li")?.querySelector(".sb-management-row-main")?.firstChild?.textContent}: ${b.textContent}`,
  );
}

test("administrators see which spaces index or failed, refreshed while building", async () => {
  api.getSearchOverview.mockResolvedValue(
    overview({ garden: "building", recipes: "failed", bikes: "ready" }),
  );
  await mount(true);
  expect(badges()).toEqual(["Garden: Indexing", "Recipes: Search failed"]);

  api.getSearchOverview.mockResolvedValue(
    overview({ garden: "ready", recipes: "failed", bikes: "ready" }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(badges()).toEqual(["Recipes: Search failed"]);
  // Nothing builds any more: no further polls.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(api.getSearchOverview).toHaveBeenCalledTimes(2);
});

test("a failed overview shows the list without badges or an error", async () => {
  api.getSearchOverview.mockRejectedValue(new Error("Forbidden"));
  await mount(true);
  expect(root.textContent).toContain("Garden");
  expect(badges()).toEqual([]);
  expect(root.querySelector(".sb-alert")).toBeNull();
});

test("members never ask for the overview", async () => {
  await mount(false);
  expect(root.textContent).toContain("Garden");
  expect(api.getSearchOverview).not.toHaveBeenCalled();
});
