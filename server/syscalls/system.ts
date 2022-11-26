import { Plug } from "../../plugos/plug.ts";
import { SysCallMapping, System } from "../../plugos/system.ts";

export function systemSyscalls(
  plugReloader: () => Promise<void>,
  system: System<any>,
): SysCallMapping {
  return {
    "system.invokeFunction": (
      ctx,
      // Ignored in this context, always assuming server (this place)
      _env: string,
      name: string,
      ...args: any[]
    ) => {
      if (!ctx.plug) {
        throw Error("No plug associated with context");
      }
      let plug: Plug<any> | undefined = ctx.plug;
      if (name.indexOf(".") !== -1) {
        // plug name in the name
        const [plugName, functionName] = name.split(".");
        plug = system.loadedPlugs.get(plugName);
        if (!plug) {
          throw Error(`Plug ${plugName} not found`);
        }
        name = functionName;
      }
      return plug.invoke(name, args);
    },
    "system.reloadPlugs": () => {
      return plugReloader();
    },
  };
}
