import type { SysCallMapping, System } from "../system.ts";
import type { FileMeta } from "../../../plug-api/types/index.ts";

export default function assetSyscalls(system: System<any>): SysCallMapping {
  return {
    "asset.readAsset": {
      callback: (_ctx, plugName: string, name: string): string => {
        return system.loadedPlugs
          .get(plugName)!
          .assets!.readFileAsDataUrl(name);
      },
      description: "Reads an asset embedded in a plug as a data URL.",
      parameters: [
        { name: "plugName", type: "string", description: "Plug name." },
        { name: "name", type: "string", description: "Asset path." },
      ],
      returns: [{ type: "string", description: "Asset data URL." }],
      examples: [
        { code: 'local image = asset.readAsset("myplug", "image.png")' },
      ],
    },
    "asset.listFiles": {
      callback: (_ctx, plugName: string): FileMeta[] => {
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
      description: "Lists the assets embedded in a plug.",
      parameters: [
        { name: "plugName", type: "string", description: "Plug name." },
      ],
      returns: [{ type: "table", description: "List of file metadata." }],
      examples: [
        {
          code: 'for _, file in ipairs(asset.listFiles("myplug")) do\n  print(file.name)\nend',
        },
      ],
    },
    "asset.getFileMeta": {
      callback: (_ctx, plugName: string, name: string): FileMeta => {
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
      description: "Gets metadata for an asset embedded in a plug.",
      parameters: [
        { name: "plugName", type: "string", description: "Plug name." },
        { name: "name", type: "string", description: "Asset path." },
      ],
      returns: [{ type: "table", description: "File metadata." }],
      examples: [
        {
          code: 'local meta = asset.getFileMeta("myplug", "data.txt")\nprint(meta.lastModified)',
        },
      ],
    },
  };
}
