import { SysCallMapping } from "../../plugos/system.ts";
import type { ExpressServer } from "../express_server.ts";

export function systemSyscalls(expressServer: ExpressServer): SysCallMapping {
  return {
    "system.invokeFunction": (
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
    "system.reloadPlugs": () => {
      return expressServer.reloadPlugs();
    },
  };
}
