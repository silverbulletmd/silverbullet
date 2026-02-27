import { Command } from "commander";

import { version } from "../version.ts";

import { plugCompileCommand } from "../client/plugos/plug_compile.ts";

const program = new Command();

program
  .name("plug-compile")
  .description("Bundle (compile) one or more plug manifests")
  .version(version)
  .usage("<options> <manifest paths>")
  .argument("<manifestPaths...>", "One or more .plug.yaml manifest files")
  .option("--debug", "Do not minify code", false)
  .option("--info", "Print out size info per function", false)
  .option("-w, --watch", "Watch for changes and rebuild", false)
  .option("--dist <path>", "Folder to put the resulting .plug.json file into", ".")
  .option("--runtimeUrl <url>", "URL to worker_runtime.ts to use")
  .action(async (manifestPaths: string[], options: any) => {
    await plugCompileCommand(
      {
        dist: options.dist,
        debug: options.debug,
        info: options.info,
        runtimeUrl: options.runtimeUrl,
      },
      ...manifestPaths,
    );
  });

program.parse(process.argv);
