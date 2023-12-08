import { Hook, Manifest } from "../types.ts";
import { System } from "../system.ts";
import { Application, Context, Next } from "../../server/deps.ts";

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
  readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  public async handleRequest(
    system: System<EndpointHookT>,
    ctx: Context,
    next: Next,
  ) {
    const req = ctx.request;
    const requestPath = ctx.request.url.pathname;
    if (!requestPath.startsWith(this.prefix)) {
      return next();
    }
    console.log("Endpoint request", requestPath);
    // Iterate over all loaded plugins
    for (const [plugName, plug] of system.loadedPlugs.entries()) {
      const manifest = plug.manifest;
      if (!manifest) {
        continue;
      }
      const functions = manifest.functions;
      // console.log("Checking plug", plugName);
      const prefix = `${this.prefix}${plugName}`;
      if (!requestPath.startsWith(prefix)) {
        continue;
      }
      for (const [name, functionDef] of Object.entries(functions)) {
        if (!functionDef.http) {
          continue;
        }
        // console.log("Got config", functionDef);
        const endpoints = Array.isArray(functionDef.http)
          ? functionDef.http
          : [functionDef.http];
        // console.log(endpoints);
        for (const { path, method } of endpoints) {
          const prefixedPath = `${prefix}${path}`;
          if (
            prefixedPath === requestPath &&
            ((method || "GET") === req.method || method === "ANY")
          ) {
            try {
              const response: EndpointResponse = await plug.invoke(name, [
                {
                  path: req.url.pathname,
                  method: req.method,
                  body: req.body(),
                  query: Object.fromEntries(
                    req.url.searchParams.entries(),
                  ),
                  headers: Object.fromEntries(req.headers.entries()),
                } as EndpointRequest,
              ]);
              if (response.headers) {
                for (
                  const [key, value] of Object.entries(
                    response.headers,
                  )
                ) {
                  ctx.response.headers.set(key, value);
                }
              }
              ctx.response.status = response.status;
              ctx.response.body = response.body;
              // console.log("Sent result");
              return;
            } catch (e: any) {
              console.error("Error executing function", e);
              ctx.response.status = 500;
              ctx.response.body = e.message;
              return;
            }
          }
        }
      }
    }
    // console.log("Shouldn't get here");
    await next();
  }

  apply(): void {
  }

  validateManifest(manifest: Manifest<EndpointHookT>): string[] {
    const errors = [];
    for (const functionDef of Object.values(manifest.functions)) {
      if (!functionDef.http) {
        continue;
      }
      const endpoints = Array.isArray(functionDef.http)
        ? functionDef.http
        : [functionDef.http];
      for (const { path, method } of endpoints) {
        if (!path) {
          errors.push("Path not defined for endpoint");
        }
        if (
          method &&
          ["GET", "POST", "PUT", "DELETE", "ANY"].indexOf(method) === -1
        ) {
          errors.push(
            `Invalid method ${method} for end point with with ${path}`,
          );
        }
      }
    }
    return errors;
  }
}
