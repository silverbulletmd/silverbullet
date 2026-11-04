import { afterEach, describe, expect, test, vi } from "vitest";
import { initLogger } from "../../lib/logger.ts";
import { System } from "../system.ts";
import { systemSyscalls } from "./system.ts";

test("listSyscalls returns cloneable metadata, without dependsOn", () => {
  const system = new System<any>();
  system.registerSyscalls([], {
    "demo.read": {
      callback: (_ctx: any, name: string) => name,
      dependsOn: (name: string) => [`demo:${name}`],
      description: "Reads.",
    },
  });
  const client = { clientSystem: { system } } as any;
  const list = (systemSyscalls(client, false) as any)[
    "system.listSyscalls"
  ].callback();
  const demo = list.find((s: any) => s.name === "demo.read");
  expect(demo.dependsOn).toBeUndefined();
  // Plug workers receive this through postMessage
  expect(() => structuredClone(list)).not.toThrow();
});

describe("recentLogs", () => {
  const originals = { ...console };
  afterEach(() => {
    Object.assign(console, originals);
    vi.unstubAllGlobals();
  });

  function setup() {
    // Logger wraps whatever console holds at construction, so stub first
    console.log = () => {};
    const logger = initLogger("[test]");
    const recentLogs = (systemSyscalls({} as any, false) as any)[
      "system.recentLogs"
    ].callback;
    return { logger, recentLogs };
  }

  test("returns the newest entries up to limit", () => {
    const { recentLogs } = setup();
    for (let i = 1; i <= 5; i++) {
      console.log(`entry ${i}`);
    }
    expect(recentLogs({}, 2).map((e: any) => e.message)).toEqual([
      "entry 4",
      "entry 5",
    ]);
    expect(recentLogs({}).length).toBe(5);
    expect(recentLogs({}, 0)).toEqual([]);
    expect(recentLogs({}, "abc").length).toBe(5);
  });

  test("still returns earlier entries after log push flushed the buffer", async () => {
    const { logger, recentLogs } = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
    console.log("before flush");
    await logger.postToServer("/.logs", "client");
    expect(logger.logBuffer).toEqual([]);
    console.log("after flush");
    expect(recentLogs({}).map((e: any) => e.message)).toEqual([
      "before flush",
      "after flush",
    ]);
  });
});
