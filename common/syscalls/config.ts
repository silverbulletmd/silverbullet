import type { SysCallMapping } from "$lib/plugos/system.ts";
import type { Client } from "../../web/client.ts";

export function configSyscalls(client: Client): SysCallMapping {
  return {
    "config.get": (_ctx, path: string, defaultValue: any) => {
      return client.config.get(path, defaultValue);
    },
    "config.set": (
      _ctx,
      keyOrValues: string | Record<string, any>,
      value?: any,
    ) => {
      if (typeof keyOrValues === "string") {
        client.config.set(keyOrValues, value);
      } else {
        client.config.set(keyOrValues);
      }
    },
    "config.has": (_ctx, path: string) => {
      return client.config.has(path);
    },
    "config.define": (_ctx, key: string, schema: any) => {
      client.config.define(key, schema);
    },
  };
}
