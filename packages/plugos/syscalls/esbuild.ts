import { compile } from "../compile";
import { SysCallMapping } from "../system";
import { tmpdir } from "os";
import { mkdir, rm, symlink, writeFile } from "fs/promises";
import { nodeModulesDir } from "../environments/node_sandbox";

const exposedModules = [
  "@silverbulletmd/plugos-silverbullet-syscall",
  "@plugos/plugos-syscall",
  "yaml",
];

export function esbuildSyscalls(): SysCallMapping {
  return {
    "esbuild.compile": async (
      ctx,
      filename: string,
      code: string,
      functionName?: string
    ): Promise<string> => {
      let tmpDir = `${tmpdir()}/plugos-${Math.random()}`;
      await mkdir(tmpDir, { recursive: true });

      const srcNodeModules = `${nodeModulesDir}/node_modules`;
      const targetNodeModules = `${tmpDir}/node_modules`;

      await mkdir(`${targetNodeModules}/@silverbulletmd`, { recursive: true });
      await mkdir(`${targetNodeModules}/@plugos`, { recursive: true });
      for (const exposedModule of exposedModules) {
        await symlink(
          `${srcNodeModules}/${exposedModule}`,
          `${targetNodeModules}/${exposedModule}`,
          "dir"
        );
      }

      await writeFile(`${tmpDir}/${filename}`, code);
      let jsCode = await compile(`${tmpDir}/${filename}`, functionName, false, [
        "yaml",
      ]);
      await rm(tmpDir, { recursive: true });
      return jsCode;
    },
  };
}
