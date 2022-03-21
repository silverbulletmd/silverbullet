import { System } from "./runtime";
import { EndpointHook } from "./types";
import express from "express";

export type EndpointRequest = {
  method: string;
  path: string;
  query: { [key: string]: string };
  headers: { [key: string]: string };
  body: any;
};

export type EndpointResponse = {
  status: number;
  headers?: { [key: string]: string };
  body: any;
};

const endPointPrefix = "/_";

export function exposeSystem(system: System<EndpointHook>) {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (!req.path.startsWith(endPointPrefix)) {
      return next();
    }
    Promise.resolve()
      .then(async () => {
        for (const [plugName, plug] of system.loadedPlugs.entries()) {
          const manifest = plug.manifest;
          if (!manifest) {
            continue;
          }
          const endpoints = manifest.hooks?.endpoints;
          if (endpoints) {
            let prefix = `${endPointPrefix}/${plugName}`;
            if (!req.path.startsWith(prefix)) {
              continue;
            }
            for (const { path, method, handler } of endpoints) {
              let prefixedPath = `${prefix}${path}`;
              if (prefixedPath === req.path && method === req.method) {
                try {
                  const response: EndpointResponse = await plug.invoke(
                    handler,
                    [
                      {
                        path: req.path,
                        method: req.method,
                        body: req.body,
                        query: req.query,
                        headers: req.headers,
                      } as EndpointRequest,
                    ]
                  );
                  let resp = res.status(response.status);
                  if (response.headers) {
                    for (const [key, value] of Object.entries(
                      response.headers
                    )) {
                      resp = resp.header(key, value);
                    }
                  }
                  resp.send(response.body);
                  return;
                } catch (e: any) {
                  console.error("Error executing function", e);
                  res.status(500).send(e.message);
                  return;
                }
              }
            }
          }
        }
        next();
      })
      .catch((e) => {
        console.error(e);
        next(e);
      });
  };
}
