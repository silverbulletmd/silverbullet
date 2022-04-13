import { SysCallMapping } from "../../plugos/system";
import { Space } from "../../common/spaces/space";

export function systemSyscalls(space: Space): SysCallMapping {
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

      if (env === "client") {
        return ctx.plug.invoke(name, args);
      }

      return space.invokeFunction(ctx.plug, env, name, args);
    },
  };
}
