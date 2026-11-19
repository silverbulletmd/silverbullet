import { expect, test, vi } from "vitest";
import type { ConfigurationModel } from "./configuration_model.ts";

vi.mock("../../navigator/navigator.ts", () => ({
  currentLayoutDefaults: vi.fn(),
}));

const { layoutSummary, saveCurrentLayout } = await import("./layout.ts");

test("layoutSummary describes each window slot", () => {
  const titles: Record<string, string> = { "std.spaceTree": "Space Tree" };
  expect(
    layoutSummary(
      {
        "std.spaceTree": { dock: "lhs", open: true, width: 280 },
        g: { dock: "rhs", open: false },
      },
      () => undefined,
      (name) => titles[name] ?? name,
    ),
  ).toEqual([
    { slot: "lhs", label: "Left", text: "Space Tree (280px)" },
    { slot: "rhs", label: "Right", text: "—" },
    { slot: "bhs", label: "Bottom", text: "—" },
  ]);
});

test("layoutSummary ignores page docks and uses the view's own dock when unset", () => {
  expect(
    layoutSummary(
      { p: { dock: "page-top", open: true }, r: { open: true } },
      (name) => (name === "r" ? "rhs" : undefined),
      (name) => name,
    ),
  ).toEqual([
    { slot: "lhs", label: "Left", text: "—" },
    { slot: "rhs", label: "Right", text: "r" },
    { slot: "bhs", label: "Bottom", text: "—" },
  ]);
});

// commitNow hands its compute function the value as loaded
function fakeModel(loaded: unknown = {}) {
  const committed: unknown[] = [];
  const commitNow = vi.fn(
    async (path: string, compute: (current: unknown) => unknown) => {
      committed.push(path, await compute(loaded));
    },
  );
  const model = { commitNow } as unknown as ConfigurationModel;
  return { model, commitNow, committed };
}

test("saveCurrentLayout refuses on a narrow screen", async () => {
  const { model, commitNow } = fakeModel();
  await expect(
    saveCurrentLayout(model, { narrow: () => true, snapshot: vi.fn() }),
  ).resolves.toBe("narrow");
  expect(commitNow).not.toHaveBeenCalled();
});

test("saveCurrentLayout commits a snapshot of the loaded value", async () => {
  const loaded = { t: { dock: "lhs", open: true } };
  const { model, committed } = fakeModel(loaded);
  const snapshot = vi.fn(async (existing: unknown) => ({ seen: existing }));
  await expect(
    saveCurrentLayout(model, { narrow: () => false, snapshot }),
  ).resolves.toBe("saved");
  expect(committed).toEqual(["view.defaults", { seen: loaded }]);
});
