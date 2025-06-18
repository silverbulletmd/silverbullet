import { Command } from "@cliffy/command";

import { publicVersion } from "./public_version.ts";

import { upgradeCommand, upgradeEdgeCommand } from "./cmd/upgrade.ts";
import { versionCommand } from "./cmd/version.ts";
import { serveCommand } from "./cmd/server.ts";
import { syncCommand } from "./cmd/sync.ts";

// Unhandled rejection, let's not crash
globalThis.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event);
  event.preventDefault();
});

await new Command()
  .name("silverbullet")
  .description("Workshop for the mind")
  .version(publicVersion)
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
  .action(serveCommand)
  // upgrade
  .command("upgrade")
  .description("Upgrade SilverBullet")
  .action(upgradeCommand)
  // upgrade-edge
  .command("upgrade-edge")
  .description("Upgrade SilverBullet to the latest edge build")
  .action(upgradeEdgeCommand)
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
