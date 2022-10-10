import { SysCallMapping, System } from "../system.ts";
import type { AssetBundle, FileMeta } from "../asset_bundle_reader.ts";

export default function assetSyscalls(system: System<any>): SysCallMapping {
  return {
    "asset.readAsset": (
      ctx,
      name: string,
    ): { data: string; meta: FileMeta } => {
      return (system.loadedPlugs.get(ctx.plug.name)!.manifest!
        .assets as AssetBundle)[name];
    },
  };
}
