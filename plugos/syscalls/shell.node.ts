import { promisify } from "util";
import { execFile } from "child_process";
import type { SysCallMapping } from "../system";

const execFilePromise = promisify(execFile);

export default function (cwd: string): SysCallMapping {
  return {
    run: async (
      ctx,
      cmd: string,
      args: string[]
    ): Promise<{ stdout: string; stderr: string }> => {
      let { stdout, stderr } = await execFilePromise(cmd, args, {
        cwd: cwd,
      });
      return { stdout, stderr };
    },
  };
}
