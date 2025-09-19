import.meta.main = false;
import { Command } from "@cliffy/command";

import { version } from "../version.ts";

import { plugCompileCommand } from "../lib/plugos/plug_compile.ts";

await new Command()
  .name("plug-compile")
  .description("Bundle (compile) one or more plug manifests")
  .version(version)
  .helpOption(false)
  .usage("<options> <manifest paths> | <command> (see below)")
  .arguments("<...name.plug.yaml:string>")
  .option("--debug", "Do not minifiy code", { default: false })
  .option("--info", "Print out size info per function", {
    default: false,
  })
  .option("--watch, -w [type:boolean]", "Watch for changes and rebuild", {
    default: false,
  })
  .option(
    "--dist <path:string>",
    "Folder to put the resulting .plug.json file into",
    { default: "." },
  )
  .option("--importmap <path:string>", "Path to import map file to use")
  .option("-c, --config <path:string>", "Path to deno.json file to use")
  .option("--runtimeUrl <url:string>", "URL to worker_runtime.ts to use")
  .action(plugCompileCommand)
  .parse(Deno.args);

Deno.exit(0);
