import { SysCallMapping } from "@plugos/plugos/system";
import type { ExpressServer } from "../express_server";

export function systemSyscalls(expressServer: ExpressServer): SysCallMapping {
  return {
    "system.invokeFunction": async (
      ctx,
      env: string,
      name: string,
      ...args: any[]
    ) => {
      if (!ctx.plug) {
        throw Error("No plug associated with context");
      }
      return ctx.plug.invoke(name, args);
    },
    "system.reloadPlugs": async () => {
      return expressServer.reloadPlugs();
    },
  };
}
