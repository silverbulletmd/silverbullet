import { SysCallMapping, System } from "../system.ts";
import { AssetBundle } from "../asset_bundle/bundle.ts";

export default function assetSyscalls(system: System<any>): SysCallMapping {
  return {
    "asset.readAsset": (
      ctx,
      name: string,
    ): string => {
      return (system.loadedPlugs.get(ctx.plug.name)!.manifest!
        .assets as AssetBundle).readFileAsDataUrl(name);
    },
  };
}
