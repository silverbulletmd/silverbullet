import { afterEach, expect, test, vi } from "vitest";
import {
  LuaStackFrame,
  LuaTable,
  type LuaNativeJSFunction,
} from "../runtime.ts";
import { netApi, proxyFetch } from "./net.ts";

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

test("proxyFetch's ok and status are the upstream's", async () => {
  const upstream = (code: string) =>
    new Response("Not here", {
      status: 200,
      headers: {
        "x-proxy-status-code": code,
        "x-proxy-header-content-type": "text/plain",
      },
    });
  const authenticatedFetch = vi.fn(async () => upstream("404"));
  vi.stubGlobal("client", {
    httpSpacePrimitives: { url: "https://sb/.fs", authenticatedFetch },
  });
  expect(await proxyFetch("https://example.com/x")).toMatchObject({
    ok: false,
    status: 404,
    body: "Not here",
  });
  authenticatedFetch.mockImplementation(async () => upstream("201"));
  expect(await proxyFetch("https://example.com/x")).toMatchObject({
    ok: true,
    status: 201,
  });
});
