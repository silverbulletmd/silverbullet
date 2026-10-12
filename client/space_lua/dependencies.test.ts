import { expect, test } from "vitest";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  callWithTracking,
  luaValueToJS,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import {
  fileChangedEvent,
  openTracker,
  tagChangedEvent,
} from "./dependencies.ts";
import { renderThread } from "./render_thread.ts";

function envWithProbe() {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.setLocal(
    "probe",
    new LuaNativeJSFunction({
      callback: (name: string) => name,
      observe: (sf, args) => sf.threadState.track?.(`probe:${args[0]}`),
    }),
  );
  return env;
}

test("event helpers", () => {
  expect(tagChangedEvent("task")).toBe("index:tag:task");
  expect(fileChangedEvent("Note.md")).toBe("file:changed:Note.md");
});

test("a closed tracker ignores later reports", () => {
  const seen: string[] = [];
  const t = openTracker((e) => seen.push(e));
  t.track!("a");
  t.close();
  t.track!("b");
  expect(seen).toEqual(["a"]);
  expect(openTracker(undefined).track).toBeUndefined();
});

test("a native function's observe hook reports to the thread's tracker", async () => {
  const env = envWithProbe();
  const seen: string[] = [];
  const { env: e, sf } = renderThread(env, null, {
    track: (ev) => seen.push(ev),
  });
  await evalExpression(parseExpressionString('probe("x")'), e, sf);
  expect(seen).toEqual(["probe:x"]);
});

test("a converted closure carries the tracker, and callWithTracking overrides it", async () => {
  const env = envWithProbe();
  const seen: string[] = [];
  const { env: e, sf } = renderThread(env, null, {
    track: (ev) => seen.push(`outer:${ev}`),
  });
  const fn = luaValueToJS(
    await evalExpression(
      parseExpressionString("function(n) return probe(n) end"),
      e,
      sf,
    ),
    sf,
  ) as (...a: any[]) => any;
  await fn("a");
  await callWithTracking(fn, (ev) => seen.push(`inner:${ev}`), "b");
  expect(seen).toEqual(["outer:probe:a", "inner:probe:b"]);
});

test("a frame without a tracker reports nothing", async () => {
  const env = envWithProbe();
  const sf = LuaStackFrame.createWithGlobalEnv(env);
  await evalExpression(parseExpressionString('probe("x")'), env, sf);
});

test("callWithTracking stops tracking once the call settles", async () => {
  const env = envWithProbe();
  const sf = LuaStackFrame.createWithGlobalEnv(env);
  const render = luaValueToJS(
    await evalExpression(
      parseExpressionString(
        'function() probe("render"); return function() probe("click") end end',
      ),
      env,
      sf,
    ),
    sf,
  ) as (...a: any[]) => any;
  const seen: string[] = [];
  const handler = await callWithTracking(render, (ev) => seen.push(ev));
  await handler();
  expect(seen).toEqual(["probe:render"]);
});
