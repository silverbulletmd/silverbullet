import { SysCallMapping } from "../../plugos/system";
import { WatchableSpace } from "../spaces/cache_space";

export function systemSyscalls(space: WatchableSpace): SysCallMapping {
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

      return space.invokeFunction(ctx.plug, env, name, args);
    },
  };
}
