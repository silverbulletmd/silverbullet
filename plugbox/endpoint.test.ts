import { createSandbox } from "./node_sandbox";
import { System } from "./runtime";
import { test, expect } from "@jest/globals";
import { EndPointDef, EndpointHook, Manifest } from "./types";
import express from "express";
import request from "supertest";
import { exposeSystem } from "./endpoints";

test("Run a plugbox endpoint server", async () => {
  let system = new System<EndpointHook>();
  let plug = await system.load(
    "test",
    {
      functions: {
        testhandler: {
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
      hooks: {
        endpoints: [{ method: "GET", path: "/", handler: "testhandler" }],
      },
    } as Manifest<EndpointHook>,
    createSandbox(system)
  );

  const app = express();
  const port = 3123;
  app.use(exposeSystem(system));
  let server = app.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
  let resp = await request(app)
    .get("/_/test/?name=Pete")
    .expect((resp) => {
      expect(resp.status).toBe(200);
      expect(resp.header["content-type"]).toContain("application/json");
      expect(resp.text).toBe(JSON.stringify([1, 2, 3]));
    });
  server.close();
});
