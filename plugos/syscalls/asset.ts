import { SysCallMapping, System } from "../system.ts";

export default function assetSyscalls(system: System<any>): SysCallMapping {
  return {
    "asset.readAsset": (
      ctx,
      name: string,
    ): string => {
      return system.loadedPlugs.get(ctx.plug.name!)!.assets!.readFileAsDataUrl(
        name,
      );
    },
  };
}
