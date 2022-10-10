import { SysCallMapping } from "../../plugos/system.ts";
import type { HttpServer } from "../http_server.ts";

export function systemSyscalls(httpServer: HttpServer): SysCallMapping {
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
      return httpServer.reloadPlugs();
    },
  };
}
