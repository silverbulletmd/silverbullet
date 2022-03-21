import { promisify } from "util";
import { execFile } from "child_process";

const execFilePromise = promisify(execFile);

export default function (cwd: string) {
  return {
    "shell.run": async (cmd: string, args: string[]) => {
      let { stdout, stderr } = await execFilePromise(cmd, args, {
        cwd: cwd,
      });
      return { stdout, stderr };
    },
  };
}
