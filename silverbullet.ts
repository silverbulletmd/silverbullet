import.meta.main = false;
import { Command } from "@cliffy/command";

import { version } from "./version.ts";

import { upgradeCommand } from "./cmd/upgrade.ts";
import { versionCommand } from "./cmd/version.ts";
import { serveCommand } from "./cmd/server.ts";
import { plugCompileCommand } from "./cmd/plug_compile.ts";
import { plugRunCommand } from "./cmd/plug_run.ts";
import { syncCommand } from "./cmd/sync.ts";
import { luaRunCommand } from "./cmd/lua_run.ts";
import { luaReplCommand } from "./cmd/lua_repl.ts";

// Unhandled rejection, let's not crash
globalThis.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event);
  event.preventDefault();
});

await new Command()
  .name("silverbullet")
  .description("Note taking for knowledge hackers")
  .version(version)
  .helpOption(false)
  .usage("<options> <folder> | <command> (see below)")
  // Main command
  .arguments("[folder:string]")
  .option(
    "-L, --hostname <hostname:string>",
    "Hostname or address to listen on",
  )
  .option("-p, --port <port:number>", "Port to listen on")
  .option(
    "--user <user:string>",
    "'username:password' combo for authentication",
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
  .command("plug:compile")
  .description("Bundle (compile) one or more plug manifests")
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
  // plug:run
  .command("plug:run")
  .description("Run a PlugOS function from the CLI")
  .arguments("<spacePath> [function] [...args:string]")
  .option(
    "-L, --hostname <hostname:string>",
    "Hostname or address to listen on",
  )
  .option("-p, --port <port:number>", "Port to listen on")
  .action(plugRunCommand)
  // lua:run
  .command("lua:run")
  .description("Run a Lua script")
  .arguments("<spacePath> <scriptPath:string>")
  .action(luaRunCommand)
  // shell
  .command("lua:repl")
  .description("Run a Lua REPL")
  .arguments("<spacePath>")
  .action(luaReplCommand)
  // upgrade
  .command("upgrade")
  .description("Upgrade SilverBullet")
  .action(upgradeCommand)
  // sync
  .command("sync")
  .description("Synchronize two spaces")
  .option(
    "--snapshot <snapshot:string>",
    "Path to state file to use",
  )
  .option(
    "--wipe-secondary",
    "Wipe secondary and perform a full sync",
  )
  .arguments("<primary:string> <secondary:string>")
  .action(syncCommand)
  // version
  .command("version")
  .description("Get current version")
  .action(versionCommand)
  .parse(Deno.args);

Deno.exit(0);
