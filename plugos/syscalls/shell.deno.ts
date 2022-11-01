import type { SysCallMapping } from "../system.ts";

export default function (cwd: string): SysCallMapping {
  return {
    "shell.run": async (
      _ctx,
      cmd: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string }> => {
      const p = Deno.run({
        cmd: [cmd, ...args],
        cwd: cwd,
        stdout: "piped",
        stderr: "piped",
      });
      await p.status();
      const stdout = new TextDecoder().decode(await p.output());
      const stderr = new TextDecoder().decode(await p.stderrOutput());

      return { stdout, stderr };
    },
  };
}
