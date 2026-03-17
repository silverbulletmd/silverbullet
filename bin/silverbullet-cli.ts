import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";

import { version } from "../version.ts";
import { SpaceConnection } from "./cli/api.ts";
import { getSpace, readConfig } from "./cli/config.ts";
import { startRepl } from "./cli/repl.ts";
import { spaceAdd, spaceList, spaceRemove } from "./cli/spaces.ts";

const program = new Command();

program
  .name("silverbullet-cli")
  .description("CLI for the SilverBullet Runtime API")
  .version(version);

// Space commands
const space = program.command("space").description("Manage space connections");

space
  .command("add")
  .description("Add a new space")
  .action(async () => {
    await spaceAdd();
  });

space
  .command("list")
  .description("List configured spaces")
  .action(async () => {
    await spaceList();
  });

space
  .command("remove")
  .argument("<name>", "Space name to remove")
  .description("Remove a space")
  .action(async (name: string) => {
    await spaceRemove(name);
  });

// Shared options for commands that talk to a space
function addSpaceOptions(cmd: Command): Command {
  return cmd
    .option("-s, --space <name>", "Space to use")
    .option("--url <url>", "Direct URL (skip space lookup)")
    .option("--token <token>", "Direct auth token")
    .option("-t, --timeout <seconds>", "Request timeout", "30");
}

function formatResult(result: any): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;
  return JSON.stringify(result);
}

async function resolveConnection(opts: {
  space?: string;
  url?: string;
  token?: string;
  timeout?: string;
}): Promise<SpaceConnection> {
  if (opts.url) {
    return new SpaceConnection({
      url: opts.url,
      token: opts.token,
      timeout: opts.timeout ? Number.parseInt(opts.timeout, 10) : undefined,
    });
  }
  const config = await readConfig();
  const spaceConfig = getSpace(config, opts.space);
  if (!spaceConfig) {
    if (config.spaces.length === 0) {
      console.error(
        "No spaces configured. Use 'silverbullet-cli space add' or pass --url.",
      );
    } else {
      console.error("Multiple spaces configured. Use -s <name> to select one.");
    }
    process.exit(1);
  }
  return new SpaceConnection({
    space: spaceConfig,
    timeout: opts.timeout ? Number.parseInt(opts.timeout, 10) : undefined,
  });
}

// lua command
addSpaceOptions(
  program
    .command("lua")
    .argument("<expression>", "Lua expression to evaluate")
    .description("Evaluate a Lua expression"),
).action(async (expression: string, opts) => {
  const conn = await resolveConnection(opts);
  try {
    const result = await conn.evalLua(expression);
    const output = formatResult(result);
    if (output) {
      process.stdout.write(output);
      if (!output.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
});

// lua-script command
addSpaceOptions(
  program
    .command("lua-script")
    .argument("[file]", "Lua script file (reads stdin if omitted)")
    .description("Execute a Lua script"),
).action(async (file: string | undefined, opts) => {
  const conn = await resolveConnection(opts);
  let script: string;

  if (file) {
    script = await readFile(file, "utf8");
  } else {
    if (process.stdin.isTTY) {
      console.error("Reading from stdin, press Ctrl-D when done.");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    script = Buffer.concat(chunks).toString("utf8");
  }

  try {
    const result = await conn.evalLuaScript(script);
    const output = formatResult(result);
    if (output) {
      process.stdout.write(output);
      if (!output.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
});

// screenshot command
addSpaceOptions(
  program
    .command("screenshot")
    .argument("[file]", "Output file path (default: stdout)")
    .description("Capture a screenshot of the headless client"),
).action(async (file: string | undefined, opts) => {
  const conn = await resolveConnection(opts);
  try {
    const png = await conn.screenshot();
    if (file) {
      await writeFile(file, png);
    } else {
      process.stdout.write(png);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
});

// logs command
addSpaceOptions(
  program
    .command("logs")
    .option("-n, --lines <count>", "Number of log entries", "100")
    .option("-f, --follow", "Follow log output")
    .description("Show console logs from the headless client"),
).action(async (opts) => {
  const conn = await resolveConnection(opts);
  try {
    const logs = await conn.logs(Number.parseInt(opts.lines, 10));
    let lastTimestamp = 0;
    for (const entry of logs) {
      const ts = new Date(entry.timestamp).toISOString();
      console.log(`${ts} [${entry.level}] ${entry.text}`);
      if (entry.timestamp > lastTimestamp) {
        lastTimestamp = entry.timestamp;
      }
    }
    if (opts.follow) {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const newLogs = await conn.logs(undefined, lastTimestamp);
        for (const entry of newLogs) {
          const ts = new Date(entry.timestamp).toISOString();
          console.log(`${ts} [${entry.level}] ${entry.text}`);
          if (entry.timestamp > lastTimestamp) {
            lastTimestamp = entry.timestamp;
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
});

// repl command
program
  .command("repl")
  .description("Interactive Lua REPL")
  .option("-s, --space <name>", "Space to use")
  .option("--url <url>", "Direct URL (skip space lookup)")
  .option("--token <token>", "Direct auth token")
  .option("-t, --timeout <seconds>", "Request timeout", "30")
  .action(async (opts) => {
    const conn = await resolveConnection(opts);
    await startRepl(conn);
  });

program.parse(process.argv);
