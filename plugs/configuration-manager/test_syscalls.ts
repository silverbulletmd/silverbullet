import { afterAll, afterEach, beforeAll } from "vitest";
import { parseBlock } from "../../client/space_lua/parse.ts";
import { prettyPrintExpression } from "../../client/space_lua/pretty_print.ts";

type Handler = (...args: any[]) => any;

/**
 * Test helper: route the `lua.*` syscalls this plug uses to the native Space
 * Lua implementations for the duration of the calling test file. Returns a
 * map into which tests can put handlers for further syscalls; it is cleared
 * after every test.
 */
export function installTestSyscalls(): Record<string, Handler> {
  const extra: Record<string, Handler> = {};
  const originalSyscall = globalThis.syscall;
  beforeAll(() => {
    globalThis.syscall = async (name: string, ...args: any[]) => {
      if (extra[name]) return extra[name](...args);
      switch (name) {
        case "lua.parseBlock":
          return parseBlock(args[0]);
        case "lua.prettyPrintExpression":
          return prettyPrintExpression(args[0], args[1]);
      }
      throw new Error(`Unexpected syscall: ${name}`);
    };
  });
  afterEach(() => {
    for (const name of Object.keys(extra)) delete extra[name];
  });
  afterAll(() => {
    globalThis.syscall = originalSyscall;
  });
  return extra;
}
