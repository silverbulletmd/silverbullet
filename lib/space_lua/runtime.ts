import type { ASTCtx, LuaFunctionBody } from "./ast.ts";
import { evalStatement, getMetatable } from "./eval.ts";
import { asyncQuickSort, evalPromiseValues } from "./util.ts";

export type LuaType =
  | "nil"
  | "boolean"
  | "number"
  | "string"
  | "table"
  | "function"
  | "userdata"
  | "thread";

// These types are for documentation only
export type LuaValue = any;
export type JSValue = any;

export interface ILuaFunction {
  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue;

  asString(): string;
}

export interface ILuaSettable {
  set(key: LuaValue, value: LuaValue, sf?: LuaStackFrame): void;
}

export interface ILuaGettable {
  get(key: LuaValue, sf?: LuaStackFrame): LuaValue | undefined;
}

export class LuaEnv implements ILuaSettable, ILuaGettable {
  variables = new Map<string, LuaValue>();

  constructor(readonly parent?: LuaEnv) {
  }

  setLocal(name: string, value: LuaValue) {
    this.variables.set(name, value);
  }

  set(key: string, value: LuaValue, sf?: LuaStackFrame): void {
    if (this.variables.has(key) || !this.parent) {
      this.variables.set(key, value);
    } else {
      this.parent.set(key, value, sf);
    }
  }

  has(key: string): boolean {
    if (this.variables.has(key)) {
      return true;
    }
    if (this.parent) {
      return this.parent.has(key);
    }
    return false;
  }

  get(
    name: string,
    sf?: LuaStackFrame,
  ): Promise<LuaValue> | LuaValue | undefined {
    if (this.variables.has(name)) {
      return this.variables.get(name);
    }
    if (this.parent) {
      return this.parent.get(name, sf);
    }
    return null;
  }

  /**
   * Lists all keys in the environment including its parents
   */
  keys(): string[] {
    const keys = Array.from(this.variables.keys());
    if (this.parent) {
      return keys.concat(this.parent.keys());
    }
    return keys;
  }

  toJSON(omitKeys: string[] = []): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of this.keys()) {
      if (omitKeys.includes(key)) {
        continue;
      }
      result[key] = luaValueToJS(this.get(key), LuaStackFrame.lostFrame);
    }
    return result;
  }
}

export class LuaStackFrame {
  static lostFrame = new LuaStackFrame(new LuaEnv(), null);

  constructor(
    readonly threadLocal: LuaEnv,
    readonly astCtx: ASTCtx | null,
    readonly parent?: LuaStackFrame,
  ) {
  }

  static createWithGlobalEnv(
    globalEnv: LuaEnv,
    ctx: ASTCtx | null = null,
  ): LuaStackFrame {
    const env = new LuaEnv();
    env.setLocal("_GLOBAL", globalEnv);
    return new LuaStackFrame(env, ctx);
  }

  withCtx(ctx: ASTCtx): LuaStackFrame {
    return new LuaStackFrame(this.threadLocal, ctx, this);
  }
}

export class LuaMultiRes {
  values: any[];

  constructor(values: LuaValue[] | LuaValue) {
    if (values instanceof LuaMultiRes) {
      this.values = values.values;
    } else {
      this.values = Array.isArray(values) ? values : [values];
    }
  }

  unwrap(): any {
    if (this.values.length === 0) {
      return null;
    }
    return this.values[0];
  }

  // Takes an array of either LuaMultiRes or LuaValue and flattens them into a single LuaMultiRes
  flatten(): LuaMultiRes {
    const result: any[] = [];
    for (const value of this.values) {
      if (value instanceof LuaMultiRes) {
        result.push(...value.values);
      } else {
        result.push(value);
      }
    }
    return new LuaMultiRes(result);
  }
}

export function singleResult(value: any): any {
  if (value instanceof LuaMultiRes) {
    return value.unwrap();
  } else {
    return value;
  }
}

export class LuaFunction implements ILuaFunction {
  private capturedEnv: LuaEnv;

  constructor(readonly body: LuaFunctionBody, closure: LuaEnv) {
    this.capturedEnv = closure;
  }

  async call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> {
    // Create a new environment that chains to the captured environment
    const env = new LuaEnv(this.capturedEnv);
    if (!sf) {
      console.trace(sf);
    }
    // Set _CTX to the thread local environment from the stack frame
    env.setLocal("_CTX", sf.threadLocal);

    // Evaluate all arguments
    const resolvedArgs = await evalPromiseValues(args);

    // Assign parameter values to variable names in env
    let varargs: LuaValue[] = [];
    for (let i = 0; i < this.body.parameters.length; i++) {
      const paramName = this.body.parameters[i];
      if (paramName === "...") {
        // Vararg parameter, let's collect the remainder of the resolved args into the varargs array
        varargs = resolvedArgs.slice(i);
        // Done, break out of this loop
        break;
      }
      env.setLocal(paramName, resolvedArgs[i] ?? null);
    }

    env.setLocal("...", new LuaMultiRes(varargs));

    return this.evalBody(env, sf);
  }

  asString(): string {
    return `<lua function(${this.body.parameters.join(", ")})>`;
  }

  toString(): string {
    return this.asString();
  }

  private async evalBody(
    env: LuaEnv,
    sf: LuaStackFrame,
  ): Promise<LuaValue> {
    try {
      // Evaluate the function body with returnOnReturn set to true
      const result = await evalStatement(this.body.block, env, sf, true);
      if (result !== undefined) {
        return mapFunctionReturnValue(result);
      }
    } catch (e: any) {
      if (e instanceof LuaReturn) {
        return mapFunctionReturnValue(e.values);
      } else {
        throw e;
      }
    }
  }
}

function mapFunctionReturnValue(values: any[]): any {
  if (values.length === 0) {
    return;
  } else if (values.length === 1) {
    return values[0];
  } else {
    return new LuaMultiRes(values);
  }
}

export class LuaNativeJSFunction implements ILuaFunction {
  constructor(readonly fn: (...args: JSValue[]) => JSValue) {
  }

  // Performs automatic conversion between Lua and JS values for arguments, but not for return values
  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue {
    const evaluatedArgs = evalPromiseValues(
      args.map((v) => luaValueToJS(v, sf)),
    );
    if (evaluatedArgs instanceof Promise) {
      return evaluatedArgs.then((args) => this.fn(...args));
    } else {
      return this.fn(...evaluatedArgs);
    }
  }

  asString(): string {
    return `<native js function: ${this.fn.name}>`;
  }

  toString(): string {
    return this.asString();
  }
}

export class LuaBuiltinFunction implements ILuaFunction {
  constructor(
    readonly fn: (sf: LuaStackFrame, ...args: LuaValue[]) => LuaValue,
  ) {
  }

  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue {
    // _CTX is already available via the stack frame
    return this.fn(sf, ...args);
  }

  asString(): string {
    return `<builtin lua function>`;
  }

  toString(): string {
    return this.asString();
  }
}

export class LuaTable implements ILuaSettable, ILuaGettable {
  // To optimize the table implementation we use a combination of different data structures
  public metatable: LuaTable | null;
  // When tables are used as maps, the common case is that they are string keys, so we use a simple object for that
  private stringKeys: Record<string, any>;
  // Other keys we can support using a Map as a fallback
  private otherKeys: Map<any, any> | null;
  // When tables are used as arrays, we use a native JavaScript array for that
  private arrayPart: any[];

  constructor(init?: any[] | Record<string, any>) {
    // For efficiency and performance reasons we pre-allocate these (modern JS engines are very good at optimizing this)
    this.arrayPart = Array.isArray(init) ? init : [];
    this.stringKeys = init && !Array.isArray(init) ? init : {};
    this.otherKeys = null; // Only create this when needed
    this.metatable = null;
  }

  get length(): number {
    return this.arrayPart.length;
  }

  empty(): boolean {
    return (
      Object.keys(this.stringKeys).length === 0 &&
      this.arrayPart.length === 0 &&
      (this.otherKeys === null || this.otherKeys.size === 0)
    );
  }

  keys(): any[] {
    const keys: any[] = Object.keys(this.stringKeys);
    for (let i = 0; i < this.arrayPart.length; i++) {
      keys.push(i + 1);
    }
    if (this.otherKeys) {
      for (const key of this.otherKeys.keys()) {
        keys.push(key);
      }
    }
    return keys;
  }

  has(key: LuaValue) {
    if (typeof key === "string") {
      return this.stringKeys[key] !== undefined;
    } else if (Number.isInteger(key) && key >= 1) {
      return this.arrayPart[key - 1] !== undefined;
    } else if (this.otherKeys) {
      return this.otherKeys.has(key);
    }
    return false;
  }

  rawSet(key: LuaValue, value: LuaValue): void | Promise<void> {
    if (key instanceof Promise) {
      return key.then((key) => this.rawSet(key, value));
    }
    if (value instanceof Promise) {
      return value.then(() => this.rawSet(key, value));
    }
    if (typeof key === "string") {
      this.stringKeys[key] = value;
    } else if (Number.isInteger(key) && key >= 1) {
      this.arrayPart[key - 1] = value;
    } else {
      if (!this.otherKeys) {
        this.otherKeys = new Map();
      }
      this.otherKeys.set(key, value);
    }
  }

  set(
    key: LuaValue,
    value: LuaValue,
    sf?: LuaStackFrame,
  ): Promise<void> | void {
    const metatable = getMetatable(this, sf);
    if (metatable && metatable.has("__newindex") && !this.has(key)) {
      // Invoke the meta table!
      const metaValue = metatable.get("__newindex", sf);
      if (metaValue.then) {
        // This is a promise, we need to wait for it
        return metaValue.then((metaValue: any) => {
          return luaCall(metaValue, [this, key, value], metaValue.ctx, sf);
        });
      } else {
        return luaCall(metaValue, [this, key, value], metaValue.ctx, sf);
      }
    }

    // Just set the value
    return this.rawSet(key, value);
  }

  rawGet(key: LuaValue): LuaValue | null {
    if (typeof key === "string") {
      return this.stringKeys[key];
    } else if (Number.isInteger(key) && key >= 1) {
      return this.arrayPart[key - 1];
    } else if (this.otherKeys) {
      return this.otherKeys.get(key);
    }
  }

  get(key: LuaValue, sf?: LuaStackFrame): LuaValue | Promise<LuaValue> | null {
    return luaIndexValue(this, key, sf);
  }

  insert(value: LuaValue, pos: number) {
    this.arrayPart.splice(pos - 1, 0, value);
  }

  remove(pos: number) {
    this.arrayPart.splice(pos - 1, 1);
  }

  async sort(fn?: ILuaFunction, sf?: LuaStackFrame) {
    if (fn && sf) {
      this.arrayPart = await asyncQuickSort(this.arrayPart, async (a, b) => {
        return (await fn.call(sf, a, b)) ? -1 : 1;
      });
    } else {
      this.arrayPart.sort();
    }
  }

  toJSObject(sf = LuaStackFrame.lostFrame): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of this.keys()) {
      result[key] = luaValueToJS(this.get(key, sf), sf);
    }
    return result;
  }

  toJSArray(sf = LuaStackFrame.lostFrame): any[] {
    return this.arrayPart.map((v) => luaValueToJS(v, sf));
  }

  toJS(sf = LuaStackFrame.lostFrame): Record<string, any> | any[] {
    if (this.length > 0) {
      return this.toJSArray(sf);
    } else {
      return this.toJSObject(sf);
    }
  }

  async toStringAsync(): Promise<string> {
    const metatable = getMetatable(this);
    if (metatable && metatable.has("__tostring")) {
      const metaValue = await metatable.get("__tostring");
      if (metaValue.call) {
        return metaValue.call(LuaStackFrame.lostFrame, this);
      } else {
        throw new Error("Meta table __tostring must be a function");
      }
    }
    let result = "{";
    let first = true;
    for (const key of this.keys()) {
      if (first) {
        first = false;
      } else {
        result += ", ";
      }
      if (typeof key === "number") {
        result += await luaToString(this.get(key));
        continue;
      }
      if (typeof key === "string") {
        result += key;
      } else {
        result += "[" + key + "]";
      }
      result += " = " + await luaToString(this.get(key));
    }
    result += "}";
    return result;
  }
}

/**
 * Lookup a key in a table or a metatable
 */
export function luaIndexValue(
  value: LuaValue,
  key: LuaValue,
  sf?: LuaStackFrame,
): LuaValue | Promise<LuaValue> | null {
  if (value === null || value === undefined) {
    return null;
  }
  // The value is a table, so we can try to get the value directly
  if (value instanceof LuaTable) {
    const rawValue = value.rawGet(key);
    if (rawValue !== undefined) {
      return rawValue;
    }
  }
  // If not, let's see if the value has a metatable and if it has a __index metamethod
  const metatable = getMetatable(value, sf);
  if (metatable && metatable.has("__index")) {
    // Invoke the meta table
    const metaValue = metatable.get("__index", sf);
    if (metaValue.then) {
      // Got a promise, we need to wait for it
      return metaValue.then((metaValue: any) => {
        if (metaValue.call) {
          return metaValue.call(sf, value, key);
        } else if (metaValue instanceof LuaTable) {
          return metaValue.get(key, sf);
        } else {
          throw new Error("Meta table __index must be a function or table");
        }
      });
    } else {
      if (metaValue.call) {
        return metaValue.call(sf, value, key);
      } else if (metaValue instanceof LuaTable) {
        return metaValue.get(key, sf);
      } else {
        throw new Error("Meta table __index must be a function or table");
      }
    }
  }
  // If not, perhaps let's assume this is a plain JavaScript object and we just index into it
  const objValue = value[key];
  if (objValue === undefined || objValue === null) {
    return null;
  } else {
    return objValue;
  }
}

export type LuaLValueContainer = { env: ILuaSettable; key: LuaValue };

export async function luaSet(
  obj: any,
  key: any,
  value: any,
  sf: LuaStackFrame,
): Promise<void> {
  if (!obj) {
    throw new LuaRuntimeError(
      `Not a settable object: nil`,
      sf,
    );
  }

  if (obj instanceof LuaTable || obj instanceof LuaEnv) {
    await obj.set(key, value, sf);
  } else {
    obj[key] = value;
  }
}

export function luaGet(
  obj: any,
  key: any,
  sf: LuaStackFrame,
): Promise<any> | any {
  if (obj === null || obj === undefined) {
    throw new LuaRuntimeError(
      `Attempting to index a nil value`,
      sf,
    );
  }
  if (key === null || key === undefined) {
    throw new LuaRuntimeError(
      `Attempting to index with a nil key`,
      sf,
    );
  }

  if (obj instanceof LuaTable || obj instanceof LuaEnv) {
    return obj.get(key, sf);
  } else if (typeof key === "number") {
    return obj[key - 1];
  } else {
    // Native JS object
    const val = obj[key];
    if (typeof val === "function") {
      // Automatically bind the function to the object
      return val.bind(obj);
    } else if (val === undefined) {
      return null;
    } else {
      return val;
    }
  }
}

export function luaLen(obj: any): number {
  if (obj instanceof LuaTable) {
    return obj.length;
  } else if (Array.isArray(obj)) {
    return obj.length;
  } else if (typeof obj === "string") {
    return obj.length;
  } else {
    return 0;
  }
}

export function luaCall(
  callee: any,
  args: any[],
  ctx: ASTCtx,
  sf?: LuaStackFrame,
): any {
  if (!callee) {
    throw new LuaRuntimeError(
      `Attempting to call a nil value`,
      (sf || LuaStackFrame.lostFrame).withCtx(ctx),
    );
  }

  if (typeof callee === "function") {
    const jsArgs = evalPromiseValues(
      args.map((v) => luaValueToJS(v, sf || LuaStackFrame.lostFrame)),
    );

    if (jsArgs instanceof Promise) {
      return jsArgs.then((jsArgs) => callee(...jsArgs));
    } else {
      return callee(...jsArgs);
    }
  } else if (callee instanceof LuaTable) {
    const metatable = getMetatable(callee, sf);

    if (metatable && metatable.has("__call")) {
      // Invoke the meta table
      const metaValue = metatable.get("__call", sf);

      const callMetaValue = (value: any) => {
        if (metaValue.call) {
          return luaCall(value, [callee, ...args], ctx, sf);
        } else {
          throw new Error("Meta table __call must be a function");
        }
      };

      if (metaValue.then) {
        // Got a promise, we need to wait for it
        return metaValue.then((value: any) => {
          callMetaValue(value);
        });
      } else {
        return callMetaValue(metaValue);
      }
    }
  } else if (callee.call) {
    return callee.call((sf || LuaStackFrame.lostFrame).withCtx(ctx), ...args);
  } else {
    throw new LuaRuntimeError(
      `Attempting to call a non-callable value of type: ${luaTypeOf(callee)}`,
      (sf || LuaStackFrame.lostFrame).withCtx(ctx),
    );
  }
}

export function luaEquals(a: any, b: any): boolean {
  return a === b;
}

export function luaKeys(val: any): any[] {
  if (val instanceof LuaTable) {
    return val.keys();
  } else if (Array.isArray(val)) {
    return val.map((_, i) => i + 1);
  } else {
    return Object.keys(val);
  }
}

export function luaTypeOf(val: any): LuaType | Promise<LuaType> {
  if (val === null || val === undefined) {
    return "nil";
  }
  if (val instanceof Promise) {
    return val.then((v) => luaTypeOf(v));
  } else if (typeof val === "boolean") {
    return "boolean";
  } else if (typeof val === "number") {
    return "number";
  } else if (typeof val === "string") {
    return "string";
  } else if (val instanceof LuaTable) {
    return "table";
  } else if (Array.isArray(val)) {
    return "table";
  } else if (typeof val === "function" || val.call) {
    return "function";
  } else if (typeof val === "object" && val.constructor === Object) {
    return "table";
  } else {
    return "userdata";
  }
}

// Both `break` and `return` are implemented by exception throwing
export class LuaBreak extends Error {
}

export class LuaReturn extends Error {
  constructor(readonly values: LuaValue[]) {
    super();
  }
}

export class LuaRuntimeError extends Error {
  constructor(
    override readonly message: string,
    public sf: LuaStackFrame,
    cause?: Error,
  ) {
    super(message, cause);
  }

  toPrettyString(code: string): string {
    if (!this.sf || !this.sf.astCtx?.from || !this.sf.astCtx?.to) {
      return this.toString();
    }
    let traceStr = "";
    let current: LuaStackFrame | undefined = this.sf;
    while (current) {
      const ctx = current.astCtx;
      if (!ctx || !ctx.from || !ctx.to) {
        break;
      }
      // Find the line and column
      let line = 1;
      let column = 0;
      let lastNewline = -1;
      for (let i = 0; i < ctx.from; i++) {
        if (code[i] === "\n") {
          line++;
          lastNewline = i;
          column = 0;
        } else {
          column++;
        }
      }

      // Get the full line of code for context
      const lineStart = lastNewline + 1;
      const lineEnd = code.indexOf("\n", ctx.from);
      const codeLine = code.substring(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd,
      );

      // Add position indicator
      const pointer = " ".repeat(column) + "^";

      traceStr += `* ${ctx.ref || "(unknown source)"} @ ${line}:${column}:\n` +
        `   ${codeLine}\n` +
        `   ${pointer}\n`;
      current = current.parent;
    }

    return `LuaRuntimeError: ${this.message}\nStack trace:\n${traceStr}`;
  }

  override toString() {
    return `LuaRuntimeError: ${this.message} at ${this.sf.astCtx?.from}, ${this.sf.astCtx?.to}`;
  }
}

export function luaTruthy(value: any): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value instanceof LuaTable) {
    return !value.empty();
  }
  if (value instanceof LuaMultiRes) {
    return value.values.length > 0;
  }
  return true;
}

export function luaToString(
  value: any,
  visited: Set<any> = new Set(),
): string | Promise<string> {
  if (value === null || value === undefined) {
    return "nil";
  }
  if (value instanceof Promise) {
    return value.then((v) => luaToString(v, visited));
  }
  // Check for circular references
  if (typeof value === "object" && visited.has(value)) {
    return "<circular reference>";
  }
  if (value.toStringAsync) {
    // Add to visited before recursing
    visited.add(value);
    return value.toStringAsync();
  }
  if (value.asString) {
    visited.add(value);
    return value.asString();
  }
  if (value instanceof LuaFunction) {
    // Don't recurse into the function body, just show the function signature
    return `<lua-function (${value.body.parameters.join(", ")})>`;
  }
  // Handle plain JavaScript objects in a Lua-like format
  if (typeof value === "object") {
    // Add to visited before recursing
    visited.add(value);
    return (async () => {
      let result = "{";
      let first = true;

      // Handle arrays
      if (Array.isArray(value)) {
        for (const val of value) {
          if (first) {
            first = false;
          } else {
            result += ", ";
          }
          // Recursively stringify the value, passing the visited set
          const strVal = await luaToString(val, visited);
          result += strVal;
        }
        return result + "}";
      }

      // Handle objects
      for (const [key, val] of Object.entries(value)) {
        if (first) {
          first = false;
        } else {
          result += ", ";
        }
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          result += `${key} = `;
        } else {
          result += `["${key}"] = `;
        }
        // Recursively stringify the value, passing the visited set
        const strVal = await luaToString(val, visited);
        result += strVal;
      }
      result += "}";
      return result;
    })();
  }
  return String(value);
}

export function jsToLuaValue(value: any): any {
  if (value instanceof Promise) {
    return value.then(jsToLuaValue);
  }
  if (value instanceof LuaTable) {
    return value;
  } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return value;
  } else if (Array.isArray(value) && "index" in value && "input" in value) {
    // This is a RegExpMatchArray
    const regexMatch = value as RegExpMatchArray;
    const regexMatchTable = new LuaTable();
    for (let i = 0; i < regexMatch.length; i++) {
      regexMatchTable.set(i + 1, regexMatch[i]);
    }
    regexMatchTable.set("index", regexMatch.index);
    regexMatchTable.set("input", regexMatch.input);
    regexMatchTable.set("groups", regexMatch.groups);
    return regexMatchTable;
  } else if (Array.isArray(value)) {
    const table = new LuaTable();
    for (let i = 0; i < value.length; i++) {
      table.set(i + 1, jsToLuaValue(value[i]));
    }
    return table;
  } else if (typeof value === "object") {
    const table = new LuaTable();
    for (const key in value) {
      table.set(key, jsToLuaValue(value[key]));
    }
    return table;
  } else if (typeof value === "function") {
    return new LuaNativeJSFunction(value);
  } else {
    return value;
  }
}

// Inverse of jsToLuaValue
export function luaValueToJS(value: any, sf: LuaStackFrame): any {
  if (value instanceof Promise) {
    return value.then((v) => luaValueToJS(v, sf));
  }
  if (value instanceof LuaTable) {
    return value.toJS(sf);
  } else if (
    value instanceof LuaNativeJSFunction || value instanceof LuaFunction ||
    value instanceof LuaBuiltinFunction
  ) {
    return (...args: any[]) => {
      const jsArgs = evalPromiseValues(
        args.map((v) => luaValueToJS(v, sf)),
      );
      if (jsArgs instanceof Promise) {
        return jsArgs.then((jsArgs) => value.call(sf, ...jsArgs));
      } else {
        return value.call(sf, ...jsArgs);
      }
    };
  } else {
    return value;
  }
}
