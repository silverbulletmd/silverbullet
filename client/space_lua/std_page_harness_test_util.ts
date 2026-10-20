import { readFile } from "node:fs/promises";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  luaCall,
  luaValueToJS,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

/** A service as registered through `service.define` (plus the assigned id). */
export type ServiceSpec = {
  selector: string;
  match: unknown;
  run: (data: unknown) => Promise<unknown>;
  id: string;
};

export type StdPageOptions = {
  /** Backs `clientStore`; pass one to seed or inspect it (default: empty) */
  store?: Map<string, unknown>;
  /** What `config.get` returns, read live (default: nothing set) */
  config?: Record<string, unknown>;
};

export type StdPageHarness = {
  env: LuaEnv;
  /** Every service registered by `service.define`, in definition order. */
  services: ServiceSpec[];
  /** Every command registered by `command.define`, by name. */
  commands: Map<string, () => Promise<unknown>>;
  /** The data behind `clientStore` */
  store: Map<string, unknown>;
  /**
   * Calls a (dotted) Lua global, e.g. `call("auth.headers", "github")`, and
   * returns the result as a plain JS value.
   */
  call(path: string, ...args: unknown[]): Promise<unknown>;
};

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Loads the `space-lua` blocks of Std pages (paths relative to the repository
 * root, e.g. "libraries/Library/Std/Infrastructure/Auth.md") into one Lua
 * environment, in order.
 *
 * Provided by default (override any of them via `globals`):
 * - `clientStore`: get/set/delete over `options.store`.
 * - `config`: `define` (ignored) and `get` from `options.config`.
 * - `command`: `define`, recording into the returned `commands`.
 * - `service`: `define`, `discover` (selectors may contain `*`, results sorted
 *   by `priority` descending) and `invoke` (by the match's `id`).
 *
 * Other globals (`editor`, `oauth`, `config`, ...) are mocked through
 * `globals`, a map of global name to a JS object of functions.
 */
export async function loadStdPages(
  paths: string[],
  globals: Record<string, unknown> = {},
  { store = new Map(), config = {} }: StdPageOptions = {},
): Promise<StdPageHarness> {
  const env = new LuaEnv(luaBuildStandardEnv());
  const services: ServiceSpec[] = [];
  const commands = new Map<string, () => Promise<unknown>>();
  let nextId = 0;

  const defaults: Record<string, unknown> = {
    clientStore: {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
      delete: (key: string) => {
        store.delete(key);
      },
    },
    config: {
      define: () => undefined,
      get: (key: string, def?: unknown) => config[key] ?? def ?? null,
    },
    command: {
      define: (spec: { name: string; run: () => Promise<unknown> }) => {
        commands.set(spec.name, spec.run);
      },
    },
    service: {
      define: (spec: Omit<ServiceSpec, "id">) => {
        services.push({ ...spec, id: `service-${nextId++}` });
      },
      discover: async (selector: string, input: unknown) => {
        const results: Array<Record<string, unknown>> = [];
        for (const service of services) {
          if (!globToRegExp(service.selector).test(selector)) {
            continue;
          }
          const match =
            typeof service.match === "function"
              ? await (service.match as (d: unknown) => unknown)(input)
              : service.match;
          if (match) {
            results.push({ ...(match as object), id: service.id });
          }
        }
        results.sort(
          (a, b) =>
            ((b.priority as number) ?? 0) - ((a.priority as number) ?? 0),
        );
        return results;
      },
      invoke: (match: { id: string }, input: unknown) => {
        const service = services.find((s) => s.id === match.id);
        if (!service) {
          throw new Error(`No such service: ${match.id}`);
        }
        return service.run(input);
      },
    },
  };
  for (const [name, value] of Object.entries({ ...defaults, ...globals })) {
    env.set(name, jsToLuaValue(value));
  }

  for (const path of paths) {
    const source = await readFile(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    const block = parseBlock(extractSpaceLuaFromPageText(source));
    const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
    await evalStatement(block, env, frame);
  }

  return {
    env,
    services,
    commands,
    store,
    async call(path: string, ...args: unknown[]) {
      const frame = LuaStackFrame.createWithGlobalEnv(env, {} as never);
      let target: unknown = env;
      for (const part of path.split(".")) {
        target = await (target as { get(k: string): unknown }).get(part);
      }
      const result = await luaCall(
        target,
        args.map((a) => jsToLuaValue(a)),
        {} as never,
        frame,
      );
      return luaValueToJS(result, frame);
    },
  };
}
