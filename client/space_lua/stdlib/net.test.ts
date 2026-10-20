import { afterEach, expect, test, vi } from "vitest";
import {
  LuaStackFrame,
  LuaTable,
  type LuaNativeJSFunction,
} from "../runtime.ts";
import { netApi } from "./net.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("net.writeURI passes its options on to the service", async () => {
  const invokeBestMatch = vi.fn(async () => undefined);
  vi.stubGlobal("client", {
    clientSystem: { serviceRegistry: { invokeBestMatch } },
  });
  const writeURI = netApi.get("writeURI") as LuaNativeJSFunction;
  const sf = LuaStackFrame.lostFrame;
  await writeURI.call(
    sf,
    "https://h/P",
    "text",
    new LuaTable({ conditional: true }),
  );
  await writeURI.call(sf, "https://h/Q", "more");
  expect(invokeBestMatch.mock.calls).toEqual([
    [
      "net.writeURI:https://h/P",
      { conditional: true, uri: "https://h/P", content: "text" },
    ],
    ["net.writeURI:https://h/Q", { uri: "https://h/Q", content: "more" }],
  ]);
});
