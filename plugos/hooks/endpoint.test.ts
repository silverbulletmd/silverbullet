import { createSandbox } from "../sandboxes/deno_worker_sandbox.ts";
import { EndpointHook, EndpointHookT } from "./endpoint.ts";
import { System } from "../system.ts";

import { assertEquals } from "../../test_deps.ts";
import { compileManifest } from "../compile.ts";
import { esbuild } from "../deps.ts";
import { Hono } from "../../server/deps.ts";

Deno.test("Run a plugos endpoint server", async () => {
  const tempDir = await Deno.makeTempDir();
  const system = new System<EndpointHookT>("server");

  const workerPath = await compileManifest(
    new URL("../test.plug.yaml", import.meta.url).pathname,
    tempDir,
  );

  await system.load("test", createSandbox(new URL(`file://${workerPath}`)));

  const app = new Hono();
  const port = 3123;

  const endpointHook = new EndpointHook("/_/");

  app.all("*", (context, next) => {
    return endpointHook.handleRequest(system, context, next);
  });

  const controller = new AbortController();
  Deno.serve({ port: port, signal: controller.signal }, app.fetch);

  const res = await fetch(`http://localhost:${port}/_/test/?name=Pete`);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), [1, 2, 3]);
  console.log("Aborting");
  controller.abort();
  await system.unloadAll();

  await Deno.remove(tempDir, { recursive: true });
  esbuild.stop();
});
