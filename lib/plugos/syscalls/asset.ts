import type { FileMeta } from "@silverbulletmd/silverbullet/types";
import type { SysCallMapping, System } from "../system.ts";

export default function assetSyscalls(system: System<any>): SysCallMapping {
  return {
    "asset.readAsset": (_ctx, plugName: string, name: string): string => {
      return system.loadedPlugs.get(plugName)!.assets!.readFileAsDataUrl(
        name,
      );
    },
    "asset.listFiles": (_ctx, plugName: string): FileMeta[] => {
      const assets = system.loadedPlugs.get(plugName)!.assets!;
      const fileNames = assets.listFiles();
      return fileNames.map((name) => ({
        name,
        contentType: assets.getMimeType(name),
        created: assets.getMtime(name),
        lastModified: assets.getMtime(name),
        size: -1,
        perm: "ro",
      }));
    },
    "asset.getFileMeta": (_ctx, plugName: string, name: string): FileMeta => {
      const assets = system.loadedPlugs.get(plugName)!.assets!;
      return {
        name,
        contentType: assets.getMimeType(name),
        created: assets.getMtime(name),
        lastModified: assets.getMtime(name),
        size: -1,
        perm: "ro",
      };
    },
  };
}
