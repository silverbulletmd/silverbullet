import { Command } from "https://deno.land/x/cliffy@v0.25.2/command/command.ts";

import { version } from "./version.ts";

import { upgradeCommand } from "./cmd/upgrade.ts";
import { versionCommand } from "./cmd/version.ts";
import { fixCommand } from "./cmd/fix.ts";
import { serveCommand } from "./cmd/server.ts";

await new Command()
  .name("silverbullet")
  .description("Markdown as a platform")
  .version(version)
  .help({
    colors: false,
  })
  .usage("<options> <folder> | <command> (see below)")
  // Main command
  .arguments("<folder:string>")
  .option("-p, --port <port:number>", "Port to listen on")
  .option("--password <password:string>", "Password for basic authentication")
  .action(serveCommand)
  .command("fix", "Fix a broken space")
  .arguments("<folder:string>")
  .action(fixCommand)
  .command("upgrade", "Upgrade Silver Bullet")
  .action(upgradeCommand)
  .command("version", "Get current version")
  .action(versionCommand)
  .parse(Deno.args);
