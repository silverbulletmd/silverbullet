import { Hook, Manifest } from "../types";
import { Express, NextFunction, Request, Response } from "express";
import { System } from "../system";

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

export type EndpointHookT = {
  http?: EndPointDef | EndPointDef[];
};

export type EndPointDef = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | "ANY";
  path: string;
};

export class EndpointHook implements Hook<EndpointHookT> {
  private app: Express;
  private prefix: string;

  constructor(app: Express, prefix: string) {
    this.app = app;
    this.prefix = prefix;
  }

  apply(system: System<EndpointHookT>): void {
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith(this.prefix)) {
        return next();
      }
      console.log("Endpoint request", req.path);
      Promise.resolve()
        .then(async () => {
          // Iterate over all loaded plugins
          for (const [plugName, plug] of system.loadedPlugs.entries()) {
            const manifest = plug.manifest;
            if (!manifest) {
              continue;
            }
            const functions = manifest.functions;
            console.log("Checking plug", plugName);
            let prefix = `${this.prefix}/${plugName}`;
            if (!req.path.startsWith(prefix)) {
              continue;
            }
            for (const [name, functionDef] of Object.entries(functions)) {
              if (!functionDef.http) {
                continue;
              }
              let endpoints = Array.isArray(functionDef.http)
                ? functionDef.http
                : [functionDef.http];
              console.log(endpoints);
              for (const { path, method } of endpoints) {
                let prefixedPath = `${prefix}${path}`;
                if (
                  prefixedPath === req.path &&
                  ((method || "GET") === req.method || method === "ANY")
                ) {
                  try {
                    const response: EndpointResponse = await plug.invoke(name, [
                      {
                        path: req.path,
                        method: req.method,
                        body: req.body,
                        query: req.query,
                        headers: req.headers,
                      } as EndpointRequest,
                    ]);
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
    });
  }

  validateManifest(manifest: Manifest<EndpointHookT>): string[] {
    let errors = [];
    for (const [name, functionDef] of Object.entries(manifest.functions)) {
      if (!functionDef.http) {
        continue;
      }
      let endpoints = Array.isArray(functionDef.http)
        ? functionDef.http
        : [functionDef.http];
      for (let { path, method } of endpoints) {
        if (!path) {
          errors.push("Path not defined for endpoint");
        }
        if (
          method &&
          ["GET", "POST", "PUT", "DELETE", "ANY"].indexOf(method) === -1
        ) {
          errors.push(
            `Invalid method ${method} for end point with with ${path}`
          );
        }
      }
    }
    return errors;
  }
}
