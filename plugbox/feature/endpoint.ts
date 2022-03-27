import { Feature, Manifest } from "../types";
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

export type EndpointHook = {
  endpoints?: EndPointDef[];
};

export type EndPointDef = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  handler: string; // function name
};

export class EndpointFeature implements Feature<EndpointHook> {
  private app: Express;
  private prefix: string;

  constructor(app: Express, prefix: string) {
    this.app = app;
    this.prefix = prefix;
  }

  apply(system: System<EndpointHook>): void {
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith(this.prefix)) {
        return next();
      }
      console.log("Endpoint request", req.path);
      Promise.resolve()
        .then(async () => {
          for (const [plugName, plug] of system.loadedPlugs.entries()) {
            const manifest = plug.manifest;
            if (!manifest) {
              continue;
            }
            const endpoints = manifest.hooks?.endpoints;
            console.log("Checking plug", plugName, endpoints);
            if (endpoints) {
              let prefix = `${this.prefix}/${plugName}`;
              console.log("Need prefix", prefix, "got", req.path);
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
    });
  }

  validateManifest(manifest: Manifest<EndpointHook>): string[] {
    const endpoints = manifest.hooks.endpoints;
    let errors = [];
    if (endpoints) {
      for (let { method, path, handler } of endpoints) {
        if (!path) {
          errors.push("Path not defined for endpoint");
        }
        if (["GET", "POST", "PUT", "DELETE"].indexOf(method) === -1) {
          errors.push(
            `Invalid method ${method} for end point with with ${path}`
          );
        }
        if (!manifest.functions[handler]) {
          errors.push(`Endpoint handler function ${handler} not found`);
        }
      }
    }
    return errors;
  }
}
