import { SysCallMapping, System } from "../system.ts";

export default function assetSyscalls(system: System<any>): SysCallMapping {
  return {
    "asset.readAsset": (_ctx, plugName: string, name: string): string => {
      return system.loadedPlugs.get(plugName)!.assets!.readFileAsDataUrl(
        name,
      );
    },
  };
}
