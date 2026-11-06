import { describe, expect, it } from "vitest";
import type { LintOptions, SpaceLintDiagnostic } from "../../space_lint.ts";
import { DeepCheck, type DeepCheckState } from "./deep_check.ts";

const diag = (page: string): SpaceLintDiagnostic => ({
  page,
  line: 1,
  column: 1,
  severity: "error",
  message: "bad",
  source: "lua",
});

describe("DeepCheck", () => {
  it("run moves idle → running → done and reports findings", async () => {
    const found = [diag("A")];
    const dc = new DeepCheck(async (opts: LintOptions) => {
      opts.onProgress?.({ done: 1, total: 2, page: "A", found });
      opts.onProgress?.({ done: 2, total: 2, page: "B", found: [] });
      return found;
    });
    const states: DeepCheckState[] = [];
    dc.onChange((s) => states.push(s));
    expect(dc.state.kind).toBe("idle");
    await dc.run();
    expect(states.map((s) => s.kind)).toEqual([
      "running",
      "running",
      "running",
      "done",
    ]);
    expect(states[1]).toMatchObject({ done: 1, total: 2, page: "A", found });
    expect(dc.state).toMatchObject({
      kind: "done",
      found,
      pages: 2,
      cancelled: false,
    });
  });

  it("a second run while running is ignored", async () => {
    let calls = 0;
    let release!: () => void;
    const dc = new DeepCheck(async () => {
      calls++;
      await new Promise<void>((r) => {
        release = r;
      });
      return [];
    });
    const first = dc.run();
    await dc.run();
    release();
    await first;
    expect(calls).toBe(1);
  });

  it("cancel aborts the signal and ends in done with cancelled: true", async () => {
    let signal: AbortSignal | undefined;
    const dc = new DeepCheck(
      (opts) =>
        new Promise((resolve) => {
          signal = opts.signal;
          opts.signal?.addEventListener("abort", () => resolve([diag("A")]));
        }),
    );
    const running = dc.run();
    dc.cancel();
    await running;
    expect(signal?.aborted).toBe(true);
    expect(dc.state).toMatchObject({ kind: "done", cancelled: true });
  });

  it("listeners stop receiving after unsubscribe", async () => {
    const dc = new DeepCheck(async () => []);
    let count = 0;
    const off = dc.onChange(() => count++);
    await dc.run();
    const seen = count;
    off();
    await dc.run();
    expect(count).toBe(seen);
  });

  it("a lint that throws ends in done with the error", async () => {
    const dc = new DeepCheck(async () => {
      throw new Error("boom");
    });
    await dc.run();
    expect(dc.state).toMatchObject({ kind: "done", error: "boom" });
  });

  it("a cancelled run reports the pages actually checked", async () => {
    const dc = new DeepCheck(
      (opts) =>
        new Promise((resolve) => {
          opts.onProgress?.({ done: 3, total: 10, page: "C", found: [] });
          opts.signal?.addEventListener("abort", () => resolve([]));
        }),
    );
    const running = dc.run();
    dc.cancel();
    await running;
    expect(dc.state).toMatchObject({ kind: "done", cancelled: true, pages: 3 });
  });
});
