import type { SysCallMapping } from "../system.ts";
import type { Config } from "../../config.ts";

export function configSyscalls(config: Config): SysCallMapping {
  return {
    "config.get": (_ctx, path: string, defaultValue: any) => {
      return config.get(path, defaultValue);
    },
    "config.set": (
      _ctx,
      keyOrValues: string | string[] | Record<string, any>,
      value?: any,
    ) => {
      config.set(keyOrValues as any, value);
    },
    "config.insert": (
      _ctx,
      key: string | string[],
      value: any,
    ) => {
      config.insert(key, value);
    },
    "config.has": (_ctx, path: string) => {
      return config.has(path);
    },
    "config.define": (_ctx, key: string, schema: any) => {
      config.define(key, schema);
    },
    "config.getValues": () => {
      return config.values;
    },
    "config.getSchemas": () => {
      return config.schemas;
    },
  };
}
