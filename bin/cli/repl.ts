import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { SpaceConnection } from "./api.ts";

// Check if Lua code has unbalanced block structures
function isIncomplete(code: string): boolean {
  let depth = 0;

  const openers = code.match(/\b(do|function|if|repeat)\b/g);
  const closers = code.match(/\b(end|until)\b/g);
  depth += (openers?.length || 0) - (closers?.length || 0);

  for (const ch of code) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
  }

  return depth > 0;
}

function formatResult(result: any): string | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return result;
  return JSON.stringify(result);
}

export async function startRepl(conn: SpaceConnection): Promise<void> {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: "lua> ",
  });

  let scriptMode = false;
  let scriptBuffer = "";
  let multiLineBuffer = "";

  console.log('SilverBullet Lua REPL. Type .exit or Ctrl-D to quit.');
  rl.prompt();

  rl.on("line", async (line: string) => {
    // Handle dot-commands
    if (line.trim() === ".exit") {
      rl.close();
      return;
    }

    if (line.trim() === ".script") {
      scriptMode = true;
      scriptBuffer = "";
      console.log("Entering script mode. Type .end to execute.");
      process.stdout.write("...> ");
      return;
    }

    if (scriptMode) {
      if (line.trim() === ".end") {
        scriptMode = false;
        if (scriptBuffer.trim()) {
          try {
            const result = await conn.evalLuaScript(scriptBuffer);
            const output = formatResult(result);
            if (output) console.log(output);
          } catch (err: any) {
            console.error(`Error: ${err.message}`);
          }
        }
        rl.prompt();
        return;
      }
      scriptBuffer += `${line}\n`;
      process.stdout.write("...> ");
      return;
    }

    if (line.trim().startsWith(".timeout ")) {
      const val = Number.parseInt(line.trim().split(/\s+/)[1], 10);
      if (Number.isNaN(val) || val <= 0) {
        console.error("Invalid timeout value");
      } else {
        conn.timeout = val;
        console.log(`Timeout set to ${val}s`);
      }
      rl.prompt();
      return;
    }

    // Multi-line accumulation
    multiLineBuffer += (multiLineBuffer ? "\n" : "") + line;

    if (isIncomplete(multiLineBuffer)) {
      process.stdout.write("...> ");
      return;
    }

    const code = multiLineBuffer;
    multiLineBuffer = "";

    if (!code.trim()) {
      rl.prompt();
      return;
    }

    try {
      // Use lua_script for multi-line, lua for single-line
      const isMultiLine = code.includes("\n");
      const result = isMultiLine
        ? await conn.evalLuaScript(code)
        : await conn.evalLua(code);
      const output = formatResult(result);
      if (output) console.log(output);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("");
    process.exit(0);
  });
}
