import { getNameFromPath, parseToRef } from "../../plug-api/lib/ref.ts";
import { isTrustedScriptPage } from "../../plug-api/lib/trusted_script_source.ts";
import type { System } from "../plugos/system.ts";
import {
  createRestrictedEnv,
  inertResult,
  toLuaData,
  type RestrictedAPI,
  type Capability,
} from "./restricted_env.ts";
import {
  LuaEnv,
  LuaFunction,
  originalLuaFunction,
  LuaStackFrame,
  LuaTable,
  luaCall,
  singleResult,
} from "./runtime.ts";

type RestrictedContext = ReturnType<typeof createRestrictedEnv>;
const factories = new WeakMap<LuaEnv, () => RestrictedContext>();
const contexts = new WeakMap<LuaEnv, RestrictedContext>();

export function restrictedContext(
  global: LuaEnv,
  page?: string,
  parent?: LuaEnv,
): RestrictedContext | undefined {
  for (let env = parent; env; env = env.parent) {
    const context = contexts.get(env);
    if (context) return context;
  }
  if (page && isTrustedScriptPage(page)) return;
  return factories.get(global)?.();
}

export function trustedLuaFunction(value: unknown): LuaFunction | undefined {
  const original = originalLuaFunction(value);
  if (!original) return;
  const ref = original.info.source?.ref;
  return typeof ref === "string" &&
    isTrustedScriptPage(getNameFromPath(parseToRef(ref)?.path ?? ""))
    ? original
    : undefined;
}

export function trustedCallFrame(global: LuaEnv, caller: LuaStackFrame) {
  const frame = LuaStackFrame.createWithGlobalEnv(global);
  frame.threadState.budget = caller.threadState.budget;
  frame.threadState.track = caller.threadState.track;
  frame.threadState.renderDepth = caller.threadState.renderDepth;
  frame.threadState.pageScope = caller.threadState.pageScope;
  for (const key of ["currentPage", "sourcePage"])
    frame.threadLocal.setLocal(
      key,
      toLuaData(inertResult(caller.threadLocal.get(key))),
    );
  return frame;
}

export function installRestrictedContext(global: LuaEnv, system: System<any>) {
  factories.set(global, () => {
    let state: RestrictedContext;
    const apis: Record<string, RestrictedAPI> = {};
    const unavailable: string[] = [];
    for (const [name, definition] of system.registeredSyscalls) {
      if (
        !definition.capabilities ||
        definition.capabilities.some((cap) => cap !== "space:read")
      ) {
        unavailable.push(name.startsWith("lua:") ? name.slice(4) : name);
        continue;
      }
      apis[name.startsWith("lua:") ? name.slice(4) : name] = {
        capabilities: ["space:read"],
        callback: async function (...args) {
          for (const event of definition.dependsOn?.(...args) ?? [])
            this.threadState.track?.(event);
          let value = await system.syscall({ sf: this }, name, args);
          if (value && typeof value.query === "function") {
            value = await value.query(
              { limit: 10001 },
              global,
              trustedCallFrame(global, this),
            );
            if (value.length > 10000)
              throw new Error(
                "Restricted query source exceeds 10000 rows; narrow the source",
              );
          }
          return value;
        },
      };
    }
    const seen = new Set<unknown>();
    const collect = (value: unknown, name: string, depth: number) => {
      if (depth > 4 || seen.has(value)) return;
      seen.add(value);
      if (value instanceof LuaFunction) {
        const capabilities = value.info.capabilities;
        if (
          !capabilities?.length ||
          !trustedLuaFunction(value) ||
          capabilities.some(
            (cap) => cap !== "space:read" && cap !== "widget:render",
          )
        ) {
          unavailable.push(name);
          return;
        }
        apis[name] = {
          capabilities: capabilities as Capability[],
          render: capabilities.includes("widget:render"),
          callback: async function (...args) {
            return singleResult(
              await luaCall(
                value,
                args.map((arg) => toLuaData(arg)),
                {},
                trustedCallFrame(global, this),
              ),
            );
          },
        };
      } else if (value instanceof LuaTable) {
        for (const key of value.keys())
          if (typeof key === "string" && /^[A-Za-z_][\w]*$/.test(key))
            collect(value.rawGet(key), `${name}.${key}`, depth + 1);
      }
    };
    for (const key of global.keys()) collect(global.get(key), key, 0);
    state = createRestrictedEnv(
      apis,
      ["space:read", "widget:render"],
      unavailable,
    );
    contexts.set(state.env, state);
    return state;
  });
}
