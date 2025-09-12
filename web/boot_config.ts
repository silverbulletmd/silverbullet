import {
  findNodeOfType,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import { System } from "../lib/plugos/system.ts";
import { configSyscalls } from "./syscalls/config.ts";
import { Config } from "./config.ts";
import { luaBuildStandardEnv } from "../lib/space_lua/stdlib.ts";
import { exposeSyscalls } from "./space_lua_api.ts";
import { parse } from "../lib/space_lua/parse.ts";
import { LuaEnv, LuaStackFrame } from "../lib/space_lua/runtime.ts";
import { evalStatement } from "../lib/space_lua/eval.ts";
import { BoxProxy } from "../lib/box_proxy.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { markdownSyscalls } from "./syscalls/markdown.ts";
import { yamlSyscalls } from "./syscalls/yaml.ts";
import { languageSyscalls } from "./syscalls/language.ts";
import { jsonschemaSyscalls } from "./syscalls/jsonschema.ts";
import { SilverBulletHooks } from "../lib/manifest.ts";

/**
 * Parses a page (CONFIG in practice) and extracts all space-lua code
 */
export function extractSpaceLuaFromPageText(text: string): string {
  const tree = parseMarkdown(text);
  const codes: string[] = [];
  traverseTree(tree, (node) => {
    if (node.type === "FencedCode") {
      const codeInfo = findNodeOfType(node, "CodeInfo");
      if (codeInfo?.children?.[0].text !== "space-lua") {
        return false;
      }
      const codeText = findNodeOfType(node, "CodeText");
      codes.push(codeText!.children![0].text!);
      return true;
    }
    return false;
  });
  return codes.join("\n");
}

/**
 * Runs the Lua code in a contained environment (only exposing config.* calls) to build up a config object
 */
export async function loadConfig(
  luaCode: string,
  lateBoundClient: any,
): Promise<Config> {
  const config = new Config();

  // We start with a standard env
  const rootEnv = luaBuildStandardEnv();

  // This is a system only used for the boot sequence, will be replaced later
  const bootSystem = new System<any>();
  // Only expose a limited set of syscalls that we can offer at this point
  bootSystem.registerSyscalls(
    [],
    // Collecting the config.* calls is basically what we're here for
    configSyscalls(config),
    // This offers calls like isMobile() which will be useful, and late binding for e.g. to make actionButtons run() work immediately on boot
    editorSyscalls(lateBoundClient),
    // And these, because: why not
    markdownSyscalls(lateBoundClient),
    yamlSyscalls(),
    languageSyscalls(),
    jsonschemaSyscalls(),
  );

  exposeSyscalls(rootEnv, bootSystem);

  // Parse the code
  const chunk = parse(luaCode, {});
  const sf = LuaStackFrame.createWithGlobalEnv(rootEnv, chunk.ctx);

  // And eval
  const localEnv = new LuaEnv(rootEnv);
  for (const statement of chunk.statements) {
    try {
      await evalStatement(statement, localEnv, sf);
    } catch {
      // Since people may do whatever in their Lua code, we're going to be extremely liberal in ignoring errors
      // Primarily config.* calls are processed, the rest is implicitly ignored through failure
      // TODO: Don't show anything
      // console.info("Statement errored out, but ignoring:", e.message);
    }
  }
  return config;
}
