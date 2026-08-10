import { expect, test } from "vitest";
import reducer from "./reducer.ts";
import { initialViewState } from "./types/ui.ts";

const initial = initialViewState;

test("show-keyed-panel mounts hidden when preloading", () => {
  const s1 = reducer(initial, {
    type: "show-keyed-panel",
    config: {
      key: "nav:modal",
      slot: "modal",
      mode: 100,
      html: "<div/>",
      script: "",
      hidden: true,
      events: [],
    },
  });
  expect(s1.keyedPanels.length).toEqual(1);
  expect(s1.keyedPanels[0].hidden).toEqual(true);
  expect(s1.panels.modal.mode).toEqual(undefined); // transient slot untouched
});

test("re-show same key unhides without duplicating", () => {
  const shown = {
    type: "show-keyed-panel" as const,
    config: {
      key: "nav:modal",
      slot: "modal" as const,
      mode: 100,
      html: "<div/>",
      script: "",
      hidden: false,
      events: [],
    },
  };
  const s2 = reducer(
    reducer(initial, { ...shown, config: { ...shown.config, hidden: true } }),
    shown,
  );
  expect(s2.keyedPanels.length).toEqual(1);
  expect(s2.keyedPanels[0].hidden).toEqual(false);
});

test("hide-keyed-panel keeps panel in state", () => {
  const s1 = reducer(initial, {
    type: "show-keyed-panel",
    config: {
      key: "nav:rhs",
      slot: "rhs",
      mode: 1,
      html: "x",
      script: "",
      hidden: false,
      events: [],
    },
  });
  const s2 = reducer(s1, { type: "hide-keyed-panel", key: "nav:rhs" });
  expect(s2.keyedPanels.length).toEqual(1);
  expect(s2.keyedPanels[0].hidden).toEqual(true);
});

test("showing keyed panel in a slot hides other visible keyed panel in that slot", () => {
  const a = {
    key: "a",
    slot: "modal" as const,
    mode: 100,
    html: "a",
    script: "",
    hidden: false,
    events: [],
  };
  const b = {
    key: "b",
    slot: "modal" as const,
    mode: 100,
    html: "b",
    script: "",
    hidden: false,
    events: [],
  };
  const s = reducer(reducer(initial, { type: "show-keyed-panel", config: a }), {
    type: "show-keyed-panel",
    config: b,
  });
  expect(s.keyedPanels.find((p) => p.key === "a")!.hidden).toEqual(true);
  expect(s.keyedPanels.find((p) => p.key === "b")!.hidden).toEqual(false);
});
