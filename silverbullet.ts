import.meta.main = false;
import { Command } from "https://deno.land/x/cliffy@v0.25.2/command/command.ts";

import { version } from "./version.ts";

import { upgradeCommand } from "./cmd/upgrade.ts";
import { versionCommand } from "./cmd/version.ts";
import { serveCommand } from "./cmd/server.ts";
import { plugCompileCommand } from "./cmd/plug_compile.ts";
import { userAdd } from "./cmd/user_add.ts";
import { userPasswd } from "./cmd/user_passwd.ts";
import { userDelete } from "./cmd/user_delete.ts";
import { userChgrp } from "./cmd/user_chgrp.ts";

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
    "'username:password' combo for BasicAuth authentication",
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
    "--maxFileSize [type:number]",
    "Do not sync/expose files larger than this (in MB)",
  )
  .action(serveCommand)
  // plug:compile
  .command("plug:compile", "Bundle (compile) one or more plug manifests")
  .arguments("<...name.plug.yaml:string>")
  .option("--debug [type:boolean]", "Do not minifiy code", { default: false })
  .option("--info [type:boolean]", "Print out size info per function", {
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
  .command("user:add", "Add a new user to an authentication file")
  .arguments("[username:string]")
  .option(
    "--auth <auth.json:string>",
    "User authentication file to use",
  )
  .option("-G, --group <name:string>", "Add user to group", {
    collect: true,
    default: [] as string[],
  })
  .action(userAdd)
  .command("user:delete", "Delete an existing user")
  .arguments("[username:string]")
  .option(
    "--auth <auth.json:string>",
    "User authentication file to use",
  )
  .action(userDelete)
  .command("user:chgrp", "Update user groups")
  .arguments("[username:string]")
  .option(
    "--auth <auth.json:string>",
    "User authentication file to use",
  )
  .option("-G, --group <name:string>", "Groups to put user into", {
    collect: true,
    default: [] as string[],
  })
  .action(userChgrp)
  .command("user:passwd", "Set the password for an existing user")
  .arguments("[username:string]")
  .option(
    "--auth <auth.json:string>",
    "User authentication file to use",
  )
  .action(userPasswd)
  // upgrade
  .command("upgrade", "Upgrade SilverBullet")
  .action(upgradeCommand)
  // version
  .command("version", "Get current version")
  .action(versionCommand)
  .parse(Deno.args);
