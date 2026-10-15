// @vitest-environment happy-dom
import type {
  IndexReport,
  SpaceSearchInfo,
} from "@silverbulletmd/silverbullet/type/search_admin";
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSpaceSearch: vi.fn(),
  rebuildSpaceSearch: vi.fn(),
}));
vi.mock("../api.ts", () => ({
  ...api,
  apiErrorText: (e: any) => String(e?.message ?? e),
}));

import { SpaceSearchSection } from "./SpaceSearchSection.tsx";

function index(kind: IndexReport["kind"], state: object): IndexReport {
  return {
    kind,
    pages: 3,
    bytes: 2048,
    memory: false,
    buildSecs: 0.1,
    ...state,
  } as IndexReport;
}

function info(indexes: IndexReport[]): SpaceSearchInfo {
  return {
    semanticChoice: null,
    semantic: "on",
    pages: 3,
    indexes,
    offer: { offByDefault: null, warning: null },
  };
}

const ready = info([
  index("fullText", { state: "ready", catchUp: null }),
  index("semantic", { state: "ready", catchUp: null }),
]);

let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.append(root);
  api.getSpaceSearch.mockReset();
  api.rebuildSpaceSearch.mockReset();
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const model = { displayName: "Tiny test model" };

function section(props: Partial<Parameters<typeof SpaceSearchSection>[0]>) {
  return h(SpaceSearchSection, {
    spaceId: "garden",
    shown: true,
    model,
    saved: null,
    value: props.saved ?? null,
    onChange: () => {},
    onUnauthorized: () => {},
    ...props,
  });
}

async function mount(
  props: Partial<Parameters<typeof SpaceSearchSection>[0]> = {},
) {
  await act(() => render(section(props), root));
  await tick(0);
}

function checkbox(): HTMLInputElement {
  return root.querySelector('input[type="checkbox"]')!;
}

function button(): HTMLButtonElement | undefined {
  return [...root.querySelectorAll("button")].find(
    (b) => b.textContent === "Rebuild search index",
  );
}

test("shows each index and rebuilds after confirming", async () => {
  api.getSpaceSearch.mockResolvedValue(ready);
  let finish: (v: SpaceSearchInfo) => void = () => {};
  api.rebuildSpaceSearch.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const confirm = vi.fn((_message: string) => true);
  vi.stubGlobal("confirm", confirm);
  await mount();
  expect(root.textContent).toContain("Semantic index");
  expect(root.textContent).toContain("Ready · 3 pages");
  expect(root.textContent).toContain(
    "On by default for this server's search model (Tiny test model). Turn it off to use full-text search only in this space.",
  );

  await act(() => button()!.click());
  expect(confirm.mock.calls[0][0]).toBe(
    "Are you sure you want to rebuild the search index?",
  );
  expect(api.rebuildSpaceSearch).toHaveBeenCalledWith("garden");
  // Disabled while the request is in flight.
  expect(button()!.disabled).toBe(true);
  await act(async () => finish(ready));
  await tick(0);
  expect(button()!.disabled).toBe(false);
});

test("Rebuild is disabled while an index builds or waits to", async () => {
  api.getSpaceSearch.mockResolvedValue(
    info([
      index("fullText", { state: "ready", catchUp: null }),
      index("semantic", { state: "building", done: 1, total: 3 }),
    ]),
  );
  await mount();
  expect(button()!.disabled).toBe(true);
  api.getSpaceSearch.mockResolvedValue(
    info([
      index("fullText", { state: "ready", catchUp: null }),
      index("semantic", { state: "waiting" }),
    ]),
  );
  await tick(2000);
  expect(button()!.disabled).toBe(true);
  api.getSpaceSearch.mockResolvedValue(ready);
  await tick(2000);
  expect(button()!.disabled).toBe(false);
});

test("a cancelled confirmation rebuilds nothing", async () => {
  api.getSpaceSearch.mockResolvedValue(ready);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => false),
  );
  await mount();
  await act(() => button()!.click());
  expect(api.rebuildSpaceSearch).not.toHaveBeenCalled();
});

test("without a model the box points to Admin → Search", async () => {
  api.getSpaceSearch.mockResolvedValue({ ...ready, semantic: "noModel" });
  await mount({ model: null });
  expect(checkbox().checked).toBe(false);
  expect(checkbox().disabled).toBe(true);
  expect(root.textContent).toContain(
    "Choose a search model in Admin → Search to turn on semantic search.",
  );
});

test("without indexes there is nothing to rebuild", async () => {
  api.getSpaceSearch.mockResolvedValue(info([]));
  await mount();
  expect(root.textContent).toContain("Search isn't available for this space.");
  expect(button()).toBeUndefined();
});

test("polls every 2 seconds while building, every 30 when ready", async () => {
  api.getSpaceSearch.mockResolvedValue(
    info([index("fullText", { state: "building", done: 1, total: 3 })]),
  );
  await mount();
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(1);
  api.getSpaceSearch.mockResolvedValue(ready);
  await tick(2000);
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(2);
  await tick(20_000);
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(2);
  await tick(10_000);
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(3);
});

test("loads only while shown, and again once the saved choice changes", async () => {
  api.getSpaceSearch.mockResolvedValue(ready);
  await mount({ shown: false });
  expect(api.getSpaceSearch).not.toHaveBeenCalled();
  expect(root.textContent).not.toContain("Search indexes");
  await mount();
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(1);
  await mount({ saved: false });
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(2);
});

test("the box is disabled until the space's info arrives", async () => {
  api.getSpaceSearch.mockReturnValue(new Promise(() => {}));
  await mount();
  expect(checkbox().disabled).toBe(true);
  expect(root.textContent).toContain(
    "On by default for this server's search model (Tiny test model).",
  );
  await mount({ spaceId: undefined, model: null });
  expect(checkbox().disabled).toBe(true);
  expect(root.textContent).toContain("Choose a search model in Admin → Search");
});

test("unchecking edits false, checking again the saved choice", async () => {
  api.getSpaceSearch.mockResolvedValue(ready);
  const onChange = vi.fn();
  function Form() {
    const [value, setValue] = useState<boolean | null>(null);
    return section({
      value,
      onChange: (choice) => {
        onChange(choice);
        setValue(choice);
      },
    });
  }
  await act(() => render(h(Form, {}), root));
  await tick(0);
  expect(checkbox().checked).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  await act(() => checkbox().click());
  expect(onChange).toHaveBeenLastCalledWith(false);
  expect(checkbox().checked).toBe(false);
  await act(() => checkbox().click());
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(checkbox().checked).toBe(true);
});

test("a poll's late answer never overwrites a rebuild's", async () => {
  api.getSpaceSearch.mockResolvedValue(ready);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  await mount();
  let late: (v: SpaceSearchInfo) => void = () => {};
  api.getSpaceSearch.mockReturnValueOnce(
    new Promise((resolve) => {
      late = resolve;
    }),
  );
  await tick(30_000);
  expect(api.getSpaceSearch).toHaveBeenCalledTimes(2);
  api.rebuildSpaceSearch.mockResolvedValue(
    info([index("fullText", { state: "building", done: 1, total: 3 })]),
  );
  await act(() => button()!.click());
  await act(async () => late(info([])));
  expect(root.textContent).toContain("Building · 1 of 3 pages");
});
