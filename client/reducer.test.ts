import { describe, expect, test } from "vitest";
import type { PageMeta } from "../plug-api/types/index.ts";
import reducer from "./reducer.ts";
import type { Action, AppViewState } from "./types/ui.ts";

function pageMeta(name: string, extra: Partial<PageMeta> = {}): PageMeta {
  return {
    ref: name,
    tag: "page",
    name,
    created: "",
    lastModified: "",
    perm: "rw",
    ...extra,
  } as PageMeta;
}

function stateWithCurrent(path: string): AppViewState {
  return {
    allPages: [],
    current: { path, meta: pageMeta("stale") },
  } as unknown as AppViewState;
}

function updatePageList(state: AppViewState, allPages: PageMeta[]) {
  return reducer(state, { type: "update-page-list", allPages } as Action);
}

describe("update-page-list current page meta matching", () => {
  test("the open markdown page's fresh meta is applied to current", () => {
    const fresh = pageMeta("foo/bar", { lastModified: "123" });
    const next = updatePageList(stateWithCurrent("foo/bar.md"), [
      pageMeta("other"),
      fresh,
    ]);
    expect(next.current!.meta).toBe(fresh);
  });

  test("a page whose name carries an extension matches its verbatim path", () => {
    const fresh = pageMeta("notes.v2");
    const next = updatePageList(stateWithCurrent("notes.v2"), [fresh]);
    expect(next.current!.meta).toBe(fresh);
  });

  test("no page matching the current path leaves current meta alone", () => {
    const state = stateWithCurrent("foo/bar.md");
    const staleMeta = state.current!.meta;
    const next = updatePageList(state, [pageMeta("unrelated")]);
    expect(next.current!.meta).toBe(staleMeta);
  });

  test("a similarly-prefixed name does not match", () => {
    const state = stateWithCurrent("foo/bar.md");
    const staleMeta = state.current!.meta;
    const next = updatePageList(state, [
      pageMeta("foo/bar.md"),
      pageMeta("foo/ba"),
    ]);
    // "foo/bar.md" as a *name* normalizes to path "foo/bar.md" and does match;
    // this pins the current (admittedly odd) matching semantics.
    expect(next.current!.meta).not.toBe(staleMeta);
    expect(next.current!.meta!.name).toBe("foo/bar.md");
  });

  test("lastOpened survives a page list refresh", () => {
    const state = {
      allPages: [pageMeta("foo", { lastOpened: 42 })],
      current: undefined,
    } as unknown as AppViewState;
    const next = updatePageList(state, [pageMeta("foo")]);
    expect(next.allPages[0].lastOpened).toBe(42);
  });
});

describe("pick-many dialog", () => {
  const options = {
    title: "Remove?",
    items: [{ id: "a", label: "A" }],
  };
  const callback = () => {};

  test("show-pick-many stores the dialog and hide-pick-many removes it by id", () => {
    const state = {} as unknown as AppViewState;
    const shown = reducer(state, {
      type: "show-pick-many",
      id: 1,
      options,
      callback,
    } as Action);
    expect(shown.pickMany).toEqual({ id: 1, options, callback });
    expect(
      reducer(shown, { type: "hide-pick-many", id: 1 } as Action).pickMany,
    ).toBeUndefined();
  });

  test("hide-pick-many for another id keeps the open dialog", () => {
    const shown = reducer(
      {} as unknown as AppViewState,
      {
        type: "show-pick-many",
        id: 2,
        options,
        callback,
      } as Action,
    );
    expect(
      reducer(shown, { type: "hide-pick-many", id: 1 } as Action).pickMany?.id,
    ).toBe(2);
  });
});
