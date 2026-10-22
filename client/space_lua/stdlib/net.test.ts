import { afterEach, expect, test, vi } from "vitest";
import {
  type LuaNativeJSFunction,
  LuaStackFrame,
  LuaTable,
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

test("net.listURI and net.deleteURI pass their options on to the service", async () => {
  const match = { id: "lister" };
  const discover = vi.fn(async () => [match]);
  const invoke = vi.fn(async () => []);
  const invokeBestMatch = vi.fn(async () => undefined);
  vi.stubGlobal("client", {
    clientSystem: { serviceRegistry: { discover, invoke, invokeBestMatch } },
  });
  const sf = LuaStackFrame.lostFrame;
  const listURI = netApi.get("listURI") as LuaNativeJSFunction;
  const deleteURI = netApi.get("deleteURI") as LuaNativeJSFunction;
  await listURI.call(sf, "https://h/dir", new LuaTable({ deep: true }));
  await listURI.call(sf, "https://h/other");
  await deleteURI.call(sf, "https://h/dir/a", new LuaTable({ force: true }));
  await deleteURI.call(sf, "https://h/dir/b");
  expect(discover.mock.calls).toEqual([
    ["net.listURI:https://h/dir", { deep: true, uri: "https://h/dir" }],
    ["net.listURI:https://h/other", { uri: "https://h/other" }],
  ]);
  expect(invoke.mock.calls).toEqual([
    [match, { deep: true, uri: "https://h/dir" }],
    [match, { uri: "https://h/other" }],
  ]);
  expect(invokeBestMatch.mock.calls).toEqual([
    ["net.deleteURI:https://h/dir/a", { force: true, uri: "https://h/dir/a" }],
    ["net.deleteURI:https://h/dir/b", { uri: "https://h/dir/b" }],
  ]);
});

test("net.listURI returns nil when no service can list", async () => {
  const invoke = vi.fn();
  vi.stubGlobal("client", {
    clientSystem: {
      serviceRegistry: { discover: vi.fn(async () => []), invoke },
    },
  });
  const listURI = netApi.get("listURI") as LuaNativeJSFunction;
  expect(
    await listURI.call(LuaStackFrame.lostFrame, "https://h/dir"),
  ).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
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
