import { afterEach, expect, test } from "vitest";
import {
  BUDGET_TICKS,
  budgetTick,
  LuaBudgetStopped,
  macrotaskYield,
  makeLuaBudget,
} from "./budget.ts";

function fakeClock() {
  const state = { t: 0 };
  return {
    now: () => state.t,
    advance: (ms: number) => {
      state.t += ms;
    },
  };
}

function noYield() {
  return Promise.resolve();
}

test("budgetTick resets ticks and accumulates busyMs when the counter expires", () => {
  const clock = fakeClock();
  const b = makeLuaBudget({ now: clock.now, doYield: noYield });
  b.ticks = 1;
  clock.advance(20);
  expect(budgetTick(b)).toBeUndefined();
  expect(b.ticks).toBe(BUDGET_TICKS);
  expect(b.busyMs).toBe(20);
});

test("an awaited interval is excluded from busyMs", () => {
  const clock = fakeClock();
  const b = makeLuaBudget({ now: clock.now, doYield: noYield });
  b.ticks = 1;
  b.awaited = true;
  clock.advance(9000);
  // Deliberately does not assert the return value: the yield counter uses raw
  // wall clock and is meant to fire here. Only busyMs excludes awaited time.
  void budgetTick(b);
  expect(b.busyMs).toBe(0);
  expect(b.awaited).toBe(false);
});

test("busyMs stays linear across consecutive non-yielding checks", () => {
  const clock = fakeClock();
  const b = makeLuaBudget({ now: clock.now, doYield: noYield });
  for (let i = 0; i < 10; i++) {
    b.ticks = 1;
    clock.advance(10);
    expect(budgetTick(b)).toBeUndefined();
  }
  // Ten checks, ten milliseconds apart: 100ms of grinding, not 550ms.
  expect(b.busyMs).toBe(100);
});

test("budgetTick yields once past YIELD_AFTER_MS and counts the yield", async () => {
  const clock = fakeClock();
  const b = makeLuaBudget({ now: clock.now, doYield: noYield });
  b.ticks = 1;
  clock.advance(600);
  const r = budgetTick(b);
  expect(r).toBeInstanceOf(Promise);
  await r;
  expect(b.yieldCount).toBe(1);
  expect(b.lastYield).toBe(600);
});

test("the first yield waits 500ms, later yields only 50ms", async () => {
  const clock = fakeClock();
  const b = makeLuaBudget({ now: clock.now, doYield: noYield });

  b.ticks = 1;
  clock.advance(100);
  expect(budgetTick(b)).toBeUndefined();
  b.ticks = 1;
  clock.advance(450);
  await budgetTick(b);
  expect(b.yieldCount).toBe(1);

  b.ticks = 1;
  clock.advance(60);
  const second = budgetTick(b);
  expect(second).toBeInstanceOf(Promise);
  await second;
  expect(b.yieldCount).toBe(2);
});

test("yieldAfterMs of Infinity never yields but still reports the limit", () => {
  const clock = fakeClock();
  let calls = 0;
  const b = makeLuaBudget({
    now: clock.now,
    doYield: noYield,
    yieldAfterMs: Infinity,
    busyLimitMs: 2000,
    onLimit: () => calls++,
  });
  for (let i = 0; i < 10; i++) {
    b.ticks = 1;
    clock.advance(1000);
    expect(budgetTick(b)).toBeUndefined();
  }
  expect(b.yieldCount).toBe(0);
  expect(calls).toBe(1);
});

test("budgetTick calls onLimit once busyMs passes busyLimitMs", () => {
  const clock = fakeClock();
  const seen: number[] = [];
  const b = makeLuaBudget({
    now: clock.now,
    doYield: noYield,
    busyLimitMs: 2000,
    onLimit: (bb) => seen.push(bb.busyMs),
  });
  b.ticks = 1;
  clock.advance(2500);
  void budgetTick(b);
  expect(seen).toEqual([2500]);
});

test("onLimit fires only once per limit window", () => {
  const clock = fakeClock();
  let calls = 0;
  const b = makeLuaBudget({
    now: clock.now,
    doYield: noYield,
    busyLimitMs: 2000,
    onLimit: () => calls++,
  });
  for (let i = 0; i < 5; i++) {
    b.ticks = 1;
    clock.advance(2500);
    void budgetTick(b);
  }
  expect(calls).toBe(1);
});

test("yieldCount backstop fires onLimit even when busyMs never accumulates", () => {
  const clock = fakeClock();
  let calls = 0;
  const b = makeLuaBudget({
    now: clock.now,
    doYield: noYield,
    onLimit: () => calls++,
  });
  for (let i = 0; i < 250; i++) {
    b.ticks = 1;
    b.awaited = true;
    clock.advance(600);
    void budgetTick(b);
  }
  expect(b.busyMs).toBe(0);
  expect(calls).toBe(1);
});

test("a stopped budget throws on every subsequent tick", () => {
  const clock = fakeClock();
  const b = makeLuaBudget({ now: clock.now, doYield: noYield });
  b.stopped = true;
  b.ticks = 1;
  expect(() => budgetTick(b)).toThrow(LuaBudgetStopped);
  b.ticks = 1;
  expect(() => budgetTick(b)).toThrow(LuaBudgetStopped);
});

test("time passing during the yield itself is not billed to busyMs", async () => {
  const clock = fakeClock();
  // Simulate a busy event-loop turn during the yield: rendering, sync,
  // another Lua invocation, etc. all take real wall-clock time before this
  // script resumes.
  const b = makeLuaBudget({
    now: clock.now,
    doYield: () => {
      clock.advance(300);
      return Promise.resolve();
    },
  });
  b.ticks = 1;
  clock.advance(600); // crosses YIELD_AFTER_MS, triggers a yield
  const r = budgetTick(b);
  expect(r).toBeInstanceOf(Promise);
  await r;
  // The 600ms of genuine grinding before the yield is billed...
  // ...but the 300ms spent yielding must not be.
  expect(b.busyMs).toBe(600);
  // lastCheck must be re-read on resume, not left at the pre-yield value,
  // or the next tick would bill the yield's duration as busy time too.
  expect(b.lastCheck).toBe(900);
});

import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
  setBoundaryBudgetFactory,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

async function runLua(code: string, budget?: any) {
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  if (budget) {
    (sf.threadState as any).budget = budget;
  }
  const ast = parseBlock(code, {});
  await evalStatement(ast, new LuaEnv(global), sf, false);
}

const BACK_EDGES: [string, string][] = [
  ["while", "local i = 0\nwhile true do i = i + 1 end"],
  ["repeat", "local i = 0\nrepeat i = i + 1 until false"],
  ["for", "local s = 0\nfor i = 1, 1e12 do s = s + 1 end"],
  [
    "for-in",
    "local function iter() return 1 end\nfor v in iter do local x = v end",
  ],
  ["goto", "local i = 0\n::top::\ni = i + 1\ngoto top"],
];

for (const [name, code] of BACK_EDGES) {
  test(`${name} back-edge is interruptible by a stopped budget`, async () => {
    const b = makeLuaBudget({ doYield: () => Promise.resolve() });
    b.stopped = true;
    b.ticks = 1;
    await expect(runLua(code, b)).rejects.toThrow(/stopped by the user/);
  });
}

test("no budget on the thread state leaves loops untouched", async () => {
  await expect(
    runLua("local s = 0\nfor i = 1, 1000 do s = s + i end"),
  ).resolves.toBeUndefined();
});

test("a for loop whose body goes async is still interruptible", async () => {
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  (sf.threadState as any).budget = b;

  global.setLocal(
    "asyncStep",
    new LuaBuiltinFunction((_sf: any) => Promise.resolve(1)),
  );
  global.setLocal(
    "__forceCheck",
    new LuaBuiltinFunction((_sf: any) => {
      b.ticks = 1;
      return null;
    }),
  );

  // Force a tick check on every iteration, and stop the budget only once
  // control has had a chance to reach runFromIndex -- the async-continuation
  // driver a loop transfers to after its first iteration returns a promise.
  let checks = 0;
  const realNow = b.now;
  b.now = () => {
    if (++checks === 3) {
      b.stopped = true;
    }
    return realNow();
  };
  b.ticks = 1;

  const ast = parseBlock(
    `
    local total = 0
    for i = 1, 1e12 do
      total = total + asyncStep()
      __forceCheck()
    end
    `,
    {},
  );

  await expect(
    evalStatement(ast, new LuaEnv(global), sf, false),
  ).rejects.toThrow(/stopped by the user/);
});

test("pcall cannot swallow a Stop", async () => {
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  b.stopped = true;
  b.ticks = 1;
  await expect(
    runLua(
      `
      local n = 0
      while true do
        pcall(function() n = n + 1 end)
      end
      `,
      b,
    ),
  ).rejects.toThrow(/stopped by the user/);
});

test("a Stop still runs <close> handlers", async () => {
  const closed: string[] = [];
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  b.stopped = true;
  b.ticks = 1;
  (sf.threadState as any).budget = b;
  global.setLocal(
    "record",
    new LuaBuiltinFunction((_sf: any, tag: string) => {
      closed.push(tag);
    }),
  );
  const ast = parseBlock(
    `
    do
      local guard <close> = setmetatable({}, { __close = function() record("closed") end })
      while true do end
    end
    `,
    {},
  );
  // evalStatement is not itself async, and this script never awaits, so the
  // budget stop throws synchronously; wrap the call so that still surfaces
  // as a promise rejection for `.rejects` to catch.
  await expect(
    (async () => evalStatement(ast, new LuaEnv(global), sf, false))(),
  ).rejects.toThrow(/stopped by the user/);
  expect(closed).toEqual(["closed"]);
});

test("pcall cannot swallow a Stop raised inside the protected call", async () => {
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  b.stopped = true;
  b.ticks = 1;
  await expect(
    runLua(`local ok = pcall(function() while true do end end)`, b),
  ).rejects.toThrow(/stopped by the user/);
});

test("xpcall cannot swallow a Stop either", async () => {
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  b.stopped = true;
  b.ticks = 1;
  await expect(
    runLua(
      `local ok = xpcall(function() while true do end end, function(e) return e end)`,
      b,
    ),
  ).rejects.toThrow(/stopped by the user/);
});

test("a throwing <close> handler cannot downgrade a Stop", async () => {
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  b.stopped = true;
  b.ticks = 1;
  await expect(
    runLua(
      `
      local ok = pcall(function()
        do
          local guard <close> = setmetatable({}, {
            __close = function() error("boom") end,
          })
          while true do end
        end
      end)
      `,
      b,
    ),
  ).rejects.toThrow(/stopped by the user/);
});

test("an ordinary error is still replaced by a throwing <close> handler", async () => {
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  const ast = parseBlock(
    `
    local ok, msg = pcall(function()
      do
        local guard <close> = setmetatable({}, {
          __close = function() error("boom") end,
        })
        error("original")
      end
    end)
    result = msg
    `,
    {},
  );
  await evalStatement(ast, new LuaEnv(global), sf, false);
  expect(String(global.get("result"))).toMatch(/boom/);
});

test("a Stop survives an async, rejecting <close> handler", async () => {
  const b = makeLuaBudget({ doYield: () => Promise.resolve() });
  b.stopped = true;
  b.ticks = 1;
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  (sf.threadState as any).budget = b;
  global.setLocal(
    "delay",
    new LuaBuiltinFunction(
      (_sf: any, ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms)),
    ),
  );
  const ast = parseBlock(
    `
    local ok = pcall(function()
      do
        local guard <close> = setmetatable({}, {
          __close = function()
            delay(5)
            error("boom")
          end,
        })
        while true do end
      end
    end)
    `,
    {},
  );
  await expect(
    evalStatement(ast, new LuaEnv(global), sf, false),
  ).rejects.toThrow(/stopped by the user/);
});

test("an ordinary error is still replaced by an async, rejecting <close> handler", async () => {
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  global.setLocal(
    "delay",
    new LuaBuiltinFunction(
      (_sf: any, ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms)),
    ),
  );
  const ast = parseBlock(
    `
    local ok, msg = pcall(function()
      do
        local guard <close> = setmetatable({}, {
          __close = function()
            delay(5)
            error("boom")
          end,
        })
        error("original")
      end
    end)
    result = msg
    `,
    {},
  );
  await evalStatement(ast, new LuaEnv(global), sf, false);
  expect(String(global.get("result"))).toMatch(/boom/);
});

test("a loop awaiting a slow syscall never accumulates busyMs", async () => {
  const clock = fakeClock();
  let limitCalls = 0;
  const b = makeLuaBudget({
    now: clock.now,
    doYield: () => Promise.resolve(),
    busyLimitMs: 2000,
    onLimit: () => limitCalls++,
  });

  const global = luaBuildStandardEnv();
  // Each call parks for five seconds of wall clock, like editor.prompt does
  // while waiting for the user, and forces a clock read on the next back-edge.
  global.setLocal(
    "slowIO",
    new LuaBuiltinFunction((_sf: any) => {
      clock.advance(5000);
      b.ticks = 1;
      return Promise.resolve(1);
    }),
  );
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  (sf.threadState as any).budget = b;

  const ast = parseBlock(
    `
    local total = 0
    for i = 1, 6 do
      total = total + slowIO()
    end
    `,
    {},
  );
  await evalStatement(ast, new LuaEnv(global), sf, false);

  expect(b.busyMs).toBe(0);
  expect(limitCalls).toBe(0);
});

// Exclude async waits outside loop back-edges too: for-header bounds,
// iterator expressions/calls, and statements preceding loops.
async function assertNeverGrinds(
  code: string,
  setup?: (
    global: ReturnType<typeof luaBuildStandardEnv>,
    clock: ReturnType<typeof fakeClock>,
    b: ReturnType<typeof makeLuaBudget>,
  ) => void,
) {
  const clock = fakeClock();
  let limitCalls = 0;
  const b = makeLuaBudget({
    now: clock.now,
    doYield: () => Promise.resolve(),
    busyLimitMs: 2000,
    // Never yield: a real yield's own resume is a separate, deliberate
    // await unrelated to whether the *user's* code awaited anything, and
    // would otherwise fold an extra tick-decrement into these tests' tight
    // manual control of when each construct's own back-edge check fires.
    yieldAfterMs: Infinity,
    onLimit: () => limitCalls++,
  });
  const global = luaBuildStandardEnv();
  global.setLocal(
    "slow",
    new LuaBuiltinFunction((_sf: any, v?: any) => {
      clock.advance(5000);
      b.ticks = 1;
      return Promise.resolve(v === undefined ? 1 : v);
    }),
  );
  // Synchronous sibling of `slow`: advances the clock and primes the next
  // tick check without itself going through any statement-sequencing
  // resume path, so it can create a wait *after* an inner back-edge has
  // already consumed a construct's inherited `awaited` flag -- isolating
  // whether that construct's own resume point re-marks it.
  global.setLocal(
    "bump",
    new LuaBuiltinFunction((_sf: any) => {
      clock.advance(5000);
      b.ticks = 1;
      return 1;
    }),
  );
  setup?.(global, clock, b);
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  (sf.threadState as any).budget = b;
  const ast = parseBlock(code, {});
  await evalStatement(ast, new LuaEnv(global), sf, false);
  expect(b.busyMs).toBe(0);
  expect(limitCalls).toBe(0);
}

const AWAIT_NEVER_GRINDS: [string, string][] = [
  [
    "while body await",
    `
    local i = 0
    while i < 6 do
      slow()
      i = i + 1
    end
    `,
  ],
  [
    "numeric for body await",
    `
    local total = 0
    for i = 1, 6 do
      total = total + slow()
    end
    `,
  ],
  [
    "backward goto with an await",
    `
    local i = 0
    ::top::
    slow()
    i = i + 1
    if i < 6 then goto top end
    `,
  ],
];

for (const [name, code] of AWAIT_NEVER_GRINDS) {
  test(`await never grinds: ${name}`, async () => {
    await assertNeverGrinds(code);
  });
}

test("await never grinds: for-in native async iterator", async () => {
  await assertNeverGrinds(
    `
    local total = 0
    for v in nativeIter do
      total = total + v
    end
    `,
    (global, clock, b) => {
      let i = 0;
      global.setLocal(
        "nativeIter",
        new LuaBuiltinFunction((_sf: any) => {
          i++;
          clock.advance(5000);
          b.ticks = 1;
          if (i > 6) return Promise.resolve(null);
          return Promise.resolve(i);
        }),
      );
    },
  );
});

// An inner back-edge consumes awaited first. Add a second unmarked wait
// so only the enclosing construct’s resume hook can exclude that time.
test("await never grinds: while body await, past an inner consumption", async () => {
  await assertNeverGrinds(
    `
    local i = 0
    while i < 1 do
      slow()
      for j = 1, 1 do end
      bump()
      i = i + 1
    end
    `,
  );
});

test("await never grinds: repeat body await, past an inner consumption", async () => {
  // Keep a trailing iteration so its back-edge observes the missing mark.
  // Use flat sibling statements: an enclosing if would introduce another
  // resume hook and mask the behavior under test.
  await assertNeverGrinds(
    `
    local i = 0
    repeat
      slow()
      for j = 1, 1 do end
      bump()
      i = i + 1
    until i >= 2
    `,
  );
});

test("await never grinds: numeric for body await (first iteration, runSyncFirst), past an inner consumption", async () => {
  await assertNeverGrinds(
    `
    local total = 0
    for i = 1, 2 do
      slow()
      for j = 1, 1 do end
      bump()
    end
    `,
  );
});

test("await never grinds: numeric for body await (later iteration, runFromIndex), past an inner consumption", async () => {
  // `bump` (synchronous) can be safely gated by an `if` -- only a nested
  // *async* resolution reintroduces the outer block's own remarking, and
  // `bump` never returns a promise -- so this is the one place an `if` is
  // needed to keep `slow` on every iteration (to keep transferring control
  // through runFromIndex) while firing the trick on iteration 2 only.
  await assertNeverGrinds(
    `
    local total = 0
    local n = 0
    for i = 1, 3 do
      slow()
      n = n + 1
      for j = 1, 1 do end
      if n == 2 then bump() end
    end
    `,
  );
});

test("await never grinds: for-in sync-iterator body await, past an inner consumption", async () => {
  await assertNeverGrinds(
    `
    local i = 0
    local function iter()
      i = i + 1
      if i > 1 then return nil end
      return i
    end
    for v in iter do
      slow()
      for j = 1, 1 do end
      bump()
    end
    `,
  );
});

// An async __close turns a synchronous loop body into a promise without
// statement-level awaits; only the loop driver can mark that wait.
test("await never grinds: while loop body with an async <close> handler", async () => {
  await assertNeverGrinds(
    `
    local i = 0
    while i < 3 do
      local g <close> = setmetatable({}, { __close = slow })
      i = i + 1
    end
    `,
  );
});

test("await never grinds: repeat loop body with an async <close> handler", async () => {
  await assertNeverGrinds(
    `
    local i = 0
    repeat
      local g <close> = setmetatable({}, { __close = slow })
      i = i + 1
    until i >= 3
    `,
  );
});

test("await never grinds: numeric for loop body with an async <close> handler", async () => {
  await assertNeverGrinds(
    `
    local total = 0
    for i = 1, 3 do
      local g <close> = setmetatable({}, { __close = slow })
      total = total + i
    end
    `,
  );
});

test("await never grinds: for-in loop body with an async <close> handler", async () => {
  await assertNeverGrinds(
    `
    local i = 0
    local function iter()
      i = i + 1
      if i > 3 then return nil end
      return i
    end
    local total = 0
    for v in iter do
      local g <close> = setmetatable({}, { __close = slow })
      total = total + v
    end
    `,
  );
});

afterEach(() => {
  setBoundaryBudgetFactory(undefined);
});

test("each JS->Lua boundary call gets its own budget", async () => {
  const budgets: any[] = [];
  setBoundaryBudgetFactory(() => {
    const b = makeLuaBudget({ doYield: () => Promise.resolve() });
    budgets.push(b);
    return b;
  });

  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  const env = new LuaEnv(global);
  await evalStatement(
    parseBlock("f = function() return 1 end", {}),
    env,
    sf,
    false,
  );
  const jsFn = luaValueToJS(global.get("f"), sf);

  await jsFn();
  await jsFn();
  await jsFn();

  expect(budgets.length).toBe(3);
  expect(new Set(budgets).size).toBe(3);
});

test("without a boundary factory the captured frame is reused unchanged", async () => {
  const global = luaBuildStandardEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(global);
  const env = new LuaEnv(global);
  await evalStatement(
    parseBlock("f = function() return 7 end", {}),
    env,
    sf,
    false,
  );
  const jsFn = luaValueToJS(global.get("f"), sf);
  expect(await jsFn()).toBe(7);
});

test("macrotaskYield actually turns the event loop", async () => {
  let timerFired = false;
  setTimeout(() => {
    timerFired = true;
  }, 0);
  for (let i = 0; i < 20; i++) {
    await macrotaskYield();
  }
  expect(timerFired).toBe(true);
});
