import { beforeEach, expect, test, vi } from "vitest";
import type { Row, ViewMeta } from "../types.ts";

const syscall = vi.fn<(name: string, ...args: any[]) => Promise<any>>();
const handle = vi.fn<(data: any) => Promise<any>>();

vi.mock("@silverbulletmd/silverbullet/syscall", () => ({
  syscall: (name: string, ...args: any[]) => syscall(name, ...args),
}));
vi.mock("../registry.ts", () => ({ handle: (data: any) => handle(data) }));

const { NavigatorEngine, parseIcon } = await import("./engine.ts");

function meta(overrides: Partial<ViewMeta> = {}): ViewMeta {
  return {
    name: "v",
    title: "V",
    mode: "list",
    dock: "modal",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "view",
    followEditor: false,
    refreshOn: [],
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    limit: 200,
    search: "client",
    hasRowIcon: false,
    pathCompletion: false,
    hashtagFilter: false,
    ...overrides,
  };
}

function bridge(viewMeta: ViewMeta, rows: unknown[]) {
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") return Promise.resolve(viewMeta);
    if (payload.hook === "rows") return Promise.resolve(rows);
    return Promise.resolve(undefined);
  });
}

function bridgeWithRowState(
  viewMeta: ViewMeta,
  rows: unknown[],
  rowStates: unknown[],
) {
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") return Promise.resolve(viewMeta);
    if (payload.hook === "rows") return Promise.resolve(rows);
    if (payload.hook === "rowState") return Promise.resolve(rowStates);
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("an empty table from decorations becomes no decorations at all", async () => {
  bridge(meta(), [
    {
      obj: { name: "Tagged" },
      primary: "Tagged",
      decorations: [{ text: "#work" }],
    },
    { obj: { name: "Plain" }, primary: "Plain", decorations: {} },
  ]);

  const state = await new NavigatorEngine().activate("v");

  expect(state.rows[0].decorations).toEqual([{ text: "#work" }]);
  expect(state.rows[1].decorations).toBeUndefined();
  for (const row of state.rows as Row[]) {
    expect(() => (row.decorations ?? []).filter(() => true)).not.toThrow();
  }
});

test("the empty-table meta fields are normalized to absent", async () => {
  bridge(
    meta({
      actions: {} as any,
      keys: {} as any,
      segments: {} as any,
    }),
    [],
  );

  const state = await new NavigatorEngine().activate("v");

  expect(state.meta.actions).toBeUndefined();
  expect(state.meta.keys).toBeUndefined();
  expect(state.meta.segments).toBeUndefined();
});

test("a dropdown view loads its options and per-row masks with every load", async () => {
  const rows = [
    { obj: { name: "a", target: "p" }, primary: "a" },
    { obj: { name: "b", target: "q" }, primary: "b" },
  ];
  let dropdownCalls = 0;
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") {
      return Promise.resolve(meta({ dropdown: { placeholder: "Recipient" } }));
    }
    if (payload.hook === "rows") return Promise.resolve(rows);
    if (payload.hook === "dropdown") {
      dropdownCalls++;
      expect(payload.args.objs).toEqual(rows.map((r) => r.obj));
      return Promise.resolve({
        options: [{ label: "Pete", value: "p" }],
        masks: [[true], [false]],
      });
    }
    return Promise.resolve(undefined);
  });
  const engine = new NavigatorEngine();

  const state = await engine.activate("v");

  expect(state.dropdownOptions).toEqual([{ label: "Pete", value: "p" }]);
  expect(state.dropdownMasks?.get(state.rows[0])).toEqual([true]);
  expect(state.dropdownMasks?.get(state.rows[1])).toEqual([false]);

  // The refreshOn/refreshOnOpen cycle goes through refresh(): the options are
  // re-evaluated with the rows, not once at define time.
  await engine.refresh();
  expect(dropdownCalls).toBe(2);
});

test("a failing dropdown hook leaves options absent without breaking the load", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") {
      return Promise.resolve(meta({ dropdown: {} }));
    }
    if (payload.hook === "rows") {
      return Promise.resolve([{ obj: { name: "a" }, primary: "a" }]);
    }
    if (payload.hook === "dropdown") {
      return Promise.reject(new Error("kaboom"));
    }
    return Promise.resolve(undefined);
  });

  const state = await new NavigatorEngine().activate("v");

  expect(state.rows.length).toBe(1);
  expect(state.dropdownOptions).toBeUndefined();
  expect(state.dropdownMasks).toBeUndefined();
  expect(errorSpy).toHaveBeenCalledWith(
    "navigator: dropdown state failed",
    expect.anything(),
  );
  errorSpy.mockRestore();
});

test("parseIcon reads a bare name as a Feather name", () => {
  expect(parseIcon("lock")).toEqual({ kind: "feather", name: "lock" });
});

test("parseIcon strips a feather: prefix down to the bare name", () => {
  expect(parseIcon("feather:lock")).toEqual({ kind: "feather", name: "lock" });
});

test("parseIcon takes a string starting with <svg as literal markup", () => {
  const markup = "<svg viewBox='0 0 24 24'><path d='M0 0'/></svg>";
  expect(parseIcon(markup)).toEqual({ kind: "svg", markup });
});

test("parseIcon trims leading whitespace before sniffing for <svg", () => {
  const markup = "<svg viewBox='0 0 24 24'></svg>";
  expect(parseIcon(`  \n\t${markup}`)).toEqual({ kind: "svg", markup });
});

test("parseIcon reports an unrecognized namespace, not a Feather name", () => {
  expect(parseIcon("lucide:lock")).toEqual({
    kind: "unknown",
    prefix: "lucide",
  });
});

test("parseIcon trims leading whitespace before scanning for a namespace colon", () => {
  expect(parseIcon("  \tfeather:lock")).toEqual({
    kind: "feather",
    name: "lock",
  });
  expect(parseIcon("  lock")).toEqual({ kind: "feather", name: "lock" });
});

test("parseIcon classifies a non-string as invalid, without throwing", () => {
  // The pre-consolidation { svg = ... } table can still reach here at runtime, since a row.icon function's return value isn't checked until it runs.
  expect(parseIcon({ svg: "<svg></svg>" })).toEqual({ kind: "invalid" });
  expect(parseIcon(undefined)).toEqual({ kind: "invalid" });
  expect(parseIcon(42)).toEqual({ kind: "invalid" });
});

test("an unrecognized icon namespace resolves nothing and warns once per prefix, not per row", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  bridgeWithRowState(
    meta({ hasRowIcon: true }),
    [
      { obj: { name: "a" }, primary: "a" },
      { obj: { name: "b" }, primary: "b" },
      { obj: { name: "c" }, primary: "c" },
    ],
    [{ icon: "bogus:one" }, { icon: "bogus:two" }, { icon: "other:x" }],
  );

  const state = await new NavigatorEngine().activate("v");

  for (const row of state.rows as Row[]) {
    expect(state.rowState?.byRow?.get(row)?.icon).toBeUndefined();
  }
  expect(errorSpy).toHaveBeenCalledTimes(2);
  expect(errorSpy).toHaveBeenCalledWith(
    'navigator: unknown icon namespace "bogus:"',
  );
  expect(errorSpy).toHaveBeenCalledWith(
    'navigator: unknown icon namespace "other:"',
  );
  errorSpy.mockRestore();
});

// The real-world trigger is a client one version stale against its host during a rolling upgrade, where icon.resolveFeather doesn't exist yet and the syscall rejects.
test("a rejected icon.resolveFeather syscall still completes the render, without icons, warning once", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  syscall.mockImplementation((name: string) => {
    if (name === "icon.resolveFeather") {
      return Promise.reject(
        new Error("Unregistered syscall icon.resolveFeather"),
      );
    }
    return Promise.resolve(undefined);
  });
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") {
      return Promise.resolve(meta({ hasRowIcon: true }));
    }
    if (payload.hook === "rows") {
      return Promise.resolve([
        { obj: { name: "a" }, primary: "a" },
        { obj: { name: "b" }, primary: "b" },
      ]);
    }
    if (payload.hook === "rowState") {
      return Promise.resolve([{ icon: "lock" }, { icon: "file" }]);
    }
    return Promise.resolve(undefined);
  });

  const state = await new NavigatorEngine().activate("v");

  expect(state.rows.length).toBe(2);
  for (const row of state.rows as Row[]) {
    expect(state.rowState?.byRow?.get(row)?.icon).toBeUndefined();
  }
  expect(warnSpy).toHaveBeenCalledTimes(1);
  expect(String(warnSpy.mock.calls[0][0])).toContain("icon resolution failed");
  warnSpy.mockRestore();
});

test("dropIfEphemeral evicts an ephemeral view's cache entry, and clears activeName if it was current", async () => {
  bridge(meta({ ephemeral: true }), []);
  const engine = new NavigatorEngine();
  await engine.activate("v");

  expect(engine.isLoaded("v")).toBe(true);
  engine.dropIfEphemeral("v");
  expect(engine.isLoaded("v")).toBe(false);
  expect(engine.activeState()).toBeUndefined();
});

test("dropIfEphemeral is a no-op for an ordinary (non-ephemeral) view", async () => {
  bridge(meta(), []);
  const engine = new NavigatorEngine();
  await engine.activate("v");

  engine.dropIfEphemeral("v");
  expect(engine.isLoaded("v")).toBe(true);
});

test("a Lua-owned view's meta is re-resolved on every activate, picking up a redefinition without a reload", async () => {
  let title = "First";
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") return Promise.resolve(meta({ title }));
    if (payload.hook === "rows") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  const engine = new NavigatorEngine();

  const first = await engine.activate("v");
  expect(first.meta.title).toBe("First");

  title = "Redefined";
  const second = await engine.activate("v");
  expect(second.meta.title).toBe("Redefined");
});

// dropIfRedefined is what activation.ts calls instead of activate when reopening the already-displayed view -- a cached hit activate alone would leave untouched, so it has to detect a redefinition on that path too.
test("dropIfRedefined drops a cached Lua view whose meta changed, and reports true", async () => {
  bridge(meta({ title: "First" }), []);
  const engine = new NavigatorEngine();
  await engine.activate("v");

  bridge(meta({ title: "Redefined" }), []);
  expect(await engine.dropIfRedefined("v")).toBe(true);
  expect(engine.isLoaded("v")).toBe(false);

  const reloaded = await engine.activate("v");
  expect(reloaded.meta.title).toBe("Redefined");
});

test("dropIfRedefined is a no-op when the resolved meta is unchanged", async () => {
  bridge(meta({ title: "Same" }), []);
  const engine = new NavigatorEngine();
  await engine.activate("v");

  expect(await engine.dropIfRedefined("v")).toBe(false);
  expect(engine.isLoaded("v")).toBe(true);
});

test("dropIfRedefined never touches a cached built-in view", async () => {
  bridge(meta({ builtin: true }), []);
  const engine = new NavigatorEngine();
  await engine.activate("v");

  bridge(meta({ builtin: true, title: "Would-be redefinition" }), []);
  expect(await engine.dropIfRedefined("v")).toBe(false);
  expect(engine.isLoaded("v")).toBe(true);
});

test("dropIfRedefined is a no-op for a view that was never activated", async () => {
  const engine = new NavigatorEngine();
  expect(await engine.dropIfRedefined("never-activated")).toBe(false);
});

test("a built-in's meta is resolved once and never asked for again on later activations", async () => {
  let metaCalls = 0;
  handle.mockImplementation((payload: any) => {
    if (payload.hook === "meta") {
      metaCalls++;
      return Promise.resolve(meta({ builtin: true }));
    }
    if (payload.hook === "rows") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  const engine = new NavigatorEngine();

  await engine.activate("v");
  await engine.activate("v");
  await engine.activate("v");

  expect(metaCalls).toBe(1);
});

test("a row.icon crossing the bridge as a table (not a string) draws nothing and never throws or warns", async () => {
  // Belt-and-suspenders: a row.icon function's return value isn't known until it runs, so the pre-consolidation { svg = ... } table can still reach this bridge at runtime even past validateRowIcon.
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  bridgeWithRowState(
    meta({ hasRowIcon: true }),
    [{ obj: { name: "a" }, primary: "a" }],
    [{ icon: { svg: "<svg></svg>" } as unknown as string }],
  );

  const state = await new NavigatorEngine().activate("v");

  expect(state.rowState?.byRow?.get(state.rows[0])?.icon).toBeUndefined();
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
