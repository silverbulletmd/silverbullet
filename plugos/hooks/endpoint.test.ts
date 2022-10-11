import { sandboxFactory } from "../environments/deno_sandbox.ts";
import { Manifest } from "../types.ts";
import { EndpointHook, EndpointHookT } from "./endpoint.ts";
import { System } from "../system.ts";

import { Application } from "../../server/deps.ts";
import { assertEquals } from "../../test_deps.ts";

import assetBundle from "../../dist/asset_bundle.json" assert { type: "json" };
import { AssetBundle } from "../asset_bundle_reader.ts";

Deno.test("Run a plugos endpoint server", async () => {
  const createSandbox = sandboxFactory(assetBundle as AssetBundle);
  let system = new System<EndpointHookT>("server");
  let plug = await system.load(
    {
      name: "test",
      functions: {
        testhandler: {
          http: {
            path: "/",
          },
          code: `(() => {
          return {
            default: (req) => {
              console.log("Req", req);
              return {status: 200, body: [1, 2, 3], headers: {"Content-type": "application/json"}};
            }
          };
        })()`,
        },
      },
    } as Manifest<EndpointHookT>,
    createSandbox,
  );

  const app = new Application();
  const port = 3123;

  system.addHook(new EndpointHook(app, "/_"));

  const controller = new AbortController();
  app.listen({ port: port, signal: controller.signal });

  const res = await fetch(`http://localhost:${port}/_/test/?name=Pete`);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-type"), "application/json");
  assertEquals(await res.json(), [1, 2, 3]);
  console.log("Aborting");
  controller.abort();
  await system.unloadAll();
});
