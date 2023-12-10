import.meta.main = false;
import { Command } from "https://deno.land/x/cliffy@v0.25.2/command/command.ts";

import { version } from "./version.ts";

import { upgradeCommand } from "./cmd/upgrade.ts";
import { versionCommand } from "./cmd/version.ts";
import { serveCommand } from "./cmd/server.ts";
import { plugCompileCommand } from "./cmd/plug_compile.ts";
import { plugRunCommand } from "./cmd/plug_run.ts";

await new Command()
  .name("silverbullet")
  .description("Markdown as a platform")
  .version(version)
  .help({
    colors: false,
  })
  .usage("<options> <folder> | <command> (see below)")
  // Main command
  .arguments("[folder:string]")
  .option(
    "--hostname, -L <hostname:string>",
    "Hostname or address to listen on",
  )
  .option("-p, --port <port:number>", "Port to listen on")
  .option(
    "--user <user:string>",
    "'username:password' combo for authentication",
  )
  .option(
    "--auth <auth.json:string>",
    "User authentication file to use for authentication",
  )
  .option(
    "--cert <certFile:string>",
    "Path to TLS certificate",
  )
  .option(
    "--key <keyFile:string>",
    "Path to TLS key",
  )
  .option(
    "--sync-only",
    "Run the server as a pure space (file) store only without any backend processing (this disables 'online mode' in the client)",
  )
  .option(
    "--reindex",
    "Reindex space on startup",
  )
  .option(
    "--db <db:string>",
    "Path to database file",
  )
  .action(serveCommand)
  // plug:compile
  .command("plug:compile", "Bundle (compile) one or more plug manifests")
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
  .option("--runtimeUrl <url:string>", "URL to worker_runtime.ts to use")
  .action(plugCompileCommand)
  // plug:run
  .command("plug:run", "Run a PlugOS function from the CLI")
  .arguments("<spacePath> [function] [...args:string]")
  .option(
    "--hostname, -L <hostname:string>",
    "Hostname or address to listen on",
  )
  .option("-p, --port <port:number>", "Port to listen on")
  .action(plugRunCommand)
  // upgrade
  .command("upgrade", "Upgrade SilverBullet")
  .action(upgradeCommand)
  // version
  .command("version", "Get current version")
  .action(versionCommand)
  .parse(Deno.args);
Deno.exit(0);
