import { describe, expect, test, vi } from "vitest";
import { type DataDeps, DataModel } from "./data_model.ts";
import type { TagListEntry, TagListSections } from "./tag_list.ts";

const entry = (name: string, count: number): TagListEntry => ({
  name,
  icon: "tag",
  count,
  defined: false,
  data: false,
  builtIn: false,
  roots: [],
});

const SECTIONS: TagListSections = {
  pinned: [entry("page", 10), entry("task", 4)],
  defined: [entry("glossary", 0)],
  noSchema: [entry("meeting", 3)],
  builtIn: [],
};

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

function setup(over: Partial<DataDeps> = {}) {
  let reload: () => void = () => {};
  let resolveLoad: (s: TagListSections) => void = () => {};
  let loads = 0;
  const deps: DataDeps = {
    loadTags: () => {
      loads++;
      return new Promise((r) => {
        resolveLoad = r;
      });
    },
    subscribeReload: (changed) => {
      reload = changed;
      return () => {};
    },
    storage: memoryStorage(),
    ...over,
  };
  const model = new DataModel(deps);
  return {
    model,
    load: (s: TagListSections) => resolveLoad(s),
    reload: () => reload(),
    loads: () => loads,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("DataModel", () => {
  test("the list is null until the first load resolves, never an empty list", async () => {
    const { model, load } = setup();
    model.subscribe(() => {});
    expect(model.tags).toBeNull();
    load(SECTIONS);
    await tick();
    expect(model.tags).toEqual(SECTIONS);
  });

  test("defaults to page in the objects view", () => {
    const { model } = setup();
    expect(model.selected).toBe("page");
    expect(model.view).toBe("objects");
  });

  test("selecting a tag without objects opens the schema view", async () => {
    const { model, load } = setup();
    model.subscribe(() => {});
    load(SECTIONS);
    await tick();
    model.select("glossary");
    expect(model.view).toBe("schema");
  });

  test("the view survives selecting another tag with objects", async () => {
    const { model, load } = setup();
    model.subscribe(() => {});
    load(SECTIONS);
    await tick();
    model.showView("schema");
    model.select("meeting");
    expect(model.selected).toBe("meeting");
    expect(model.view).toBe("schema");
  });

  test("Built-in starts collapsed; collapsed sections persist through storage", () => {
    const storage = memoryStorage();
    const first = setup({ storage }).model;
    expect(first.isCollapsed("builtIn")).toBe(true);
    expect(first.isCollapsed("defined")).toBe(false);
    first.toggleSection("defined");
    first.toggleSection("builtIn");
    const second = setup({ storage }).model;
    expect(second.isCollapsed("defined")).toBe(true);
    expect(second.isCollapsed("builtIn")).toBe(false);
  });

  test("a throwing storage is ignored", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { model } = setup({ storage });
    expect(model.isCollapsed("builtIn")).toBe(true);
    model.toggleSection("builtIn");
    expect(model.isCollapsed("builtIn")).toBe(false);
  });

  test("a reload refreshes the list and keeps the selection", async () => {
    const { model, load, reload, loads } = setup();
    model.subscribe(() => {});
    load(SECTIONS);
    await tick();
    model.select("meeting");
    reload();
    expect(loads()).toBe(2);
    load({ ...SECTIONS, noSchema: [entry("meeting", 5)] });
    await tick();
    expect(model.tags?.noSchema[0].count).toBe(5);
    expect(model.selected).toBe("meeting");
  });

  test("an invalid count lands on the tag's entry and notifies", async () => {
    const { model, load } = setup();
    let notified = 0;
    model.subscribe(() => notified++);
    load(SECTIONS);
    await tick();
    const before = notified;
    model.setInvalid("meeting", 2);
    expect(model.tags?.noSchema[0].invalid).toBe(2);
    expect(notified).toBe(before + 1);
  });

  test("a failed load keeps the list loading and records the error", async () => {
    const { model } = setup({
      loadTags: () => Promise.reject(new Error("no index")),
    });
    model.subscribe(() => {});
    await tick();
    expect(model.tags).toBeNull();
    expect(model.loadError).toBe("no index");
  });

  test("a load before the space is ready keeps the list loading", async () => {
    const { model } = setup({ loadTags: async () => null });
    model.subscribe(() => {});
    await tick();
    expect(model.tags).toBeNull();
    expect(model.loadError).toBeUndefined();
  });

  test("the tag list width is clamped and remembered", () => {
    const storage = memoryStorage();
    const first = setup({ storage }).model;
    expect(first.listWidth).toBe(168);
    first.setWidth("list", 260, true);
    expect(setup({ storage }).model.listWidth).toBe(260);
    first.setWidth("list", 20, true);
    expect(first.listWidth).toBe(120);
    first.setWidth("list", 5000, true);
    expect(first.listWidth).toBe(480);
  });

  test("a width is remembered only once the drag commits it", () => {
    const storage = memoryStorage();
    const first = setup({ storage }).model;
    first.setWidth("list", 300, false);
    expect(first.listWidth).toBe(300);
    expect(setup({ storage }).model.listWidth).toBe(168);
    first.setWidth("list", 310, true);
    expect(setup({ storage }).model.listWidth).toBe(310);
  });

  test("a load before the space is ready retries until it is", async () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      const { model } = setup({
        loadTags: async () => (ready ? SECTIONS : null),
      });
      model.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(model.tags).toBeNull();
      ready = true;
      await vi.advanceTimersByTimeAsync(1000);
      expect(model.tags).toEqual(SECTIONS);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the query editor's width is clamped and remembered too", () => {
    const storage = memoryStorage();
    const first = setup({ storage }).model;
    expect(first.clausesWidth).toBe(380);
    first.setWidth("clauses", 500, true);
    expect(setup({ storage }).model.clausesWidth).toBe(500);
    first.setWidth("clauses", 10, true);
    expect(first.clausesWidth).toBe(240);
  });
});
