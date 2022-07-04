import { createSandbox } from "../environments/node_sandbox";
import { expect, test } from "@jest/globals";
import { Manifest } from "../types";
import express from "express";
import request from "supertest";
import { EndpointHook, EndpointHookT } from "./endpoint";
import { System } from "../system";

test("Run a plugos endpoint server", async () => {
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
    createSandbox
  );

  const app = express();
  const port = 3123;

  system.addHook(new EndpointHook(app, "/_"));

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
  await system.unloadAll();
});
