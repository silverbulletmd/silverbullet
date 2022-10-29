import { sandboxCompile, sandboxCompileModule } from "../compile.ts";
import { SysCallMapping } from "../system.ts";
import { Manifest } from "../types.ts";

import importMap from "../../import_map.json" assert { type: "json" };
import { base64EncodedDataUrl } from "../asset_bundle/base64.ts";

export function esbuildSyscalls(
  imports: Manifest<any>[],
): SysCallMapping {
  return {
    "esbuild.compile": async (
      _ctx,
      filename: string,
      code: string,
      functionName?: string,
    ): Promise<string> => {
      // Override this to point to a URL
      importMap.imports["$sb/"] = "https://deno.land/x/silverbullet/plug-api/";
      const importUrl = new URL(
        base64EncodedDataUrl(
          "application/json",
          new TextEncoder().encode(JSON.stringify(importMap)),
        ),
      );
      return await sandboxCompile(
        filename,
        code,
        functionName,
        {
          debug: true,
          imports,
          importMap: importUrl,
        },
      );
    },
    "esbuild.compileModule": async (
      _ctx,
      moduleName: string,
    ): Promise<string> => {
      return await sandboxCompileModule(moduleName, {
        imports,
      });
    },
  };
}
