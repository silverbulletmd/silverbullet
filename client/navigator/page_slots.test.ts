import { beforeEach, expect, test, vi } from "vitest";

const registry = {
  allViewNames: vi.fn<() => string[]>(),
  resolveMeta: vi.fn<(name: string) => unknown>(),
};

const dockState = {
  resolveDock: vi.fn<(name: string, meta: any) => Promise<string>>(),
  isOpen: vi.fn<(name: string, meta: any) => Promise<boolean>>(),
  isCollapsed: vi.fn<(name: string) => Promise<boolean>>(),
};

vi.mock("./registry.ts", () => registry);
vi.mock("./navigator.ts", () => ({ dockState }));

const { pageSlotViews } = await import("./page_slots.ts");

function meta(name: string, dock: string, supportedDocks?: string[]) {
  return { name, dock, supportedDocks } as any;
}

const METAS: Record<string, any> = {
  bottomOpen: meta("bottomOpen", "page-bottom", ["page-bottom", "rhs"]),
  bottomClosed: meta("bottomClosed", "page-bottom", ["page-bottom", "rhs"]),
  topOpen: meta("topOpen", "page-top", ["page-top", "page-bottom"]),
  windowOnly: meta("windowOnly", "rhs", ["rhs", "lhs"]),
  bottomFirst: meta("bottomFirst", "page-bottom", ["page-bottom"]),
};

const OPEN = new Set(["bottomOpen", "topOpen", "windowOnly", "bottomFirst"]);
const COLLAPSED = new Set(["bottomFirst"]);

beforeEach(() => {
  vi.clearAllMocks();
  registry.resolveMeta.mockImplementation((name: string) => METAS[name]);
  dockState.resolveDock.mockImplementation((_name, m) =>
    Promise.resolve(m.dock),
  );
  dockState.isOpen.mockImplementation((name) =>
    Promise.resolve(OPEN.has(name)),
  );
  dockState.isCollapsed.mockImplementation((name) =>
    Promise.resolve(COLLAPSED.has(name)),
  );
});

test("returns open views resolving to the slot, in registration order", async () => {
  registry.allViewNames.mockReturnValue([
    "bottomFirst",
    "windowOnly",
    "bottomClosed",
    "topOpen",
    "bottomOpen",
  ]);
  const views = await pageSlotViews("page-bottom");
  expect(views.map((v) => v.name)).toEqual(["bottomFirst", "bottomOpen"]);
  expect(views[0].meta).toBe(METAS.bottomFirst);
  expect(await pageSlotViews("page-top")).toEqual([
    { name: "topOpen", meta: METAS.topOpen, collapsed: false },
  ]);
});

// Resolved here, with dock and open, so the widget can render collapsed on its
// very first paint. Reading it after mount would paint expanded and then roll
// up -- the same flap the slot's whole settle/measure dance exists to avoid.
test("each view carries its persisted collapse state", async () => {
  registry.allViewNames.mockReturnValue(["bottomFirst", "bottomOpen"]);
  const views = await pageSlotViews("page-bottom");
  expect(views.map((v) => [v.name, v.collapsed])).toEqual([
    ["bottomFirst", true],
    ["bottomOpen", false],
  ]);
});

test("a resolved dock elsewhere excludes an otherwise page-capable view", async () => {
  registry.allViewNames.mockReturnValue(["bottomOpen"]);
  dockState.resolveDock.mockResolvedValue("rhs");
  expect(await pageSlotViews("page-bottom")).toEqual([]);
});

test("views that cannot page-dock at all are never asked about dock state", async () => {
  registry.allViewNames.mockReturnValue(["windowOnly"]);
  expect(await pageSlotViews("page-bottom")).toEqual([]);
  expect(dockState.resolveDock).not.toHaveBeenCalled();
  expect(dockState.isOpen).not.toHaveBeenCalled();
  expect(dockState.isCollapsed).not.toHaveBeenCalled();
});

test("a view without supportedDocks falls back to its declared dock", async () => {
  registry.allViewNames.mockReturnValue(["soloTop"]);
  METAS.soloTop = meta("soloTop", "page-top");
  OPEN.add("soloTop");
  expect((await pageSlotViews("page-top")).map((v) => v.name)).toEqual([
    "soloTop",
  ]);
});

test("names without a resolvable meta are skipped", async () => {
  registry.allViewNames.mockReturnValue(["ghost", "bottomOpen"]);
  expect((await pageSlotViews("page-bottom")).map((v) => v.name)).toEqual([
    "bottomOpen",
  ]);
});
