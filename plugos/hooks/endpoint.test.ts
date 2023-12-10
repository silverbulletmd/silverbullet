import { createSandbox } from "../environments/deno_sandbox.ts";
import { EndpointHook, EndpointHookT } from "./endpoint.ts";
import { System } from "../system.ts";

import { Application } from "../../server/deps.ts";
import { assertEquals } from "../../test_deps.ts";
import { compileManifest } from "../compile.ts";
import { esbuild } from "../deps.ts";

Deno.test("Run a plugos endpoint server", async () => {
  const tempDir = await Deno.makeTempDir();
  const system = new System<EndpointHookT>("server");

  const workerPath = await compileManifest(
    new URL("../test.plug.yaml", import.meta.url).pathname,
    tempDir,
  );

  await system.load(
    new URL(`file://${workerPath}`),
    "test",
    0,
    createSandbox,
  );

  const app = new Application();
  const port = 3123;

  const endpointHook = new EndpointHook("/_/");

  app.use((context, next) => {
    return endpointHook.handleRequest(system, context, next);
  });

  const controller = new AbortController();
  app.listen({ port: port, signal: controller.signal });

  const res = await fetch(`http://localhost:${port}/_/test/?name=Pete`);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-type"), "application/json");
  assertEquals(await res.json(), [1, 2, 3]);
  console.log("Aborting");
  controller.abort();
  await system.unloadAll();

  await Deno.remove(tempDir, { recursive: true });
  esbuild.stop();
});
