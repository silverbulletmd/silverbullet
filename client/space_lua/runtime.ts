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

export type LuaValue = any;
export type JSValue = any;
export type NumKind = "int" | "float" | "unknown";

function isPromiseLike<T = unknown>(v: unknown): v is Promise<T> {
  return typeof (v as any)?.then === "function";
}

function hasCall(v: unknown): v is ILuaFunction {
  return !!v && typeof (v as any).call === "function";
}

function hasToStringAsync(
  v: unknown,
): v is { toStringAsync: () => Promise<string> } {
  return !!v && typeof (v as any).toStringAsync === "function";
}

function hasAsString(v: unknown): v is { asString: () => string } {
  return !!v && typeof (v as any).asString === "function";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export interface ILuaFunction {
  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue;
  asString(): string;
}

export interface ILuaSettable {
  set(key: LuaValue, value: LuaValue, sf?: LuaStackFrame): void | Promise<void>;
}

export interface ILuaGettable {
  get(
    key: LuaValue,
    sf?: LuaStackFrame,
  ): LuaValue | Promise<LuaValue> | undefined | null;
}

export class LuaEnv implements ILuaSettable, ILuaGettable {
  variables = new Map<string, LuaValue>();
  private numKinds = new Map<string, NumKind>();

  constructor(readonly parent?: LuaEnv) {}

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

  setNumKind(name: string, kind: NumKind) {
    this.numKinds.set(name, kind);
  }

  getNumKind(name: string): NumKind {
    if (this.numKinds.has(name)) {
      return this.numKinds.get(name)!;
    }
    if (this.parent) {
      return this.parent.getNumKind(name);
    }
    return "unknown";
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
  ): Promise<LuaValue> | LuaValue | undefined | null {
    if (this.variables.has(name)) {
      return this.variables.get(name);
    }
    if (this.parent) {
      return this.parent.get(name, sf);
    }
    return null;
  }

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
      if (omitKeys.includes(key)) continue;
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
  ) {}

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
  return value instanceof LuaMultiRes ? value.unwrap() : value;
}

export class LuaFunction implements ILuaFunction {
  private capturedEnv: LuaEnv;

  constructor(readonly body: LuaFunctionBody, closure: LuaEnv) {
    this.capturedEnv = closure;
  }

  async call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> {
    const env = new LuaEnv(this.capturedEnv);
    if (!sf) {
      console.trace(sf);
    }
    env.setLocal("_CTX", sf.threadLocal);

    const resolvedArgs = await evalPromiseValues(args);

    let varargs: LuaValue[] = [];
    for (let i = 0; i < this.body.parameters.length; i++) {
      const paramName = this.body.parameters[i];
      if (paramName === "...") {
        varargs = resolvedArgs.slice(i);
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
  constructor(readonly fn: (...args: JSValue[]) => JSValue) {}

  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue {
    const evaluatedArgs = evalPromiseValues(
      args.map((v) => luaValueToJS(v, sf)),
    );
    if (evaluatedArgs instanceof Promise) {
      return evaluatedArgs.then((argv) => this.fn(...argv));
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
  ) {}

  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue {
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
  public metatable: LuaTable | null;
  private stringKeys: Record<string, any>;
  private otherKeys: Map<any, any> | null;
  private arrayPart: any[];

  constructor(init?: any[] | Record<string, any>) {
    this.arrayPart = Array.isArray(init) ? init : [];
    this.stringKeys = init && !Array.isArray(init) ? init : {};
    this.otherKeys = null;
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
    if (isPromiseLike(key)) {
      return key.then((k) => this.rawSet(k, value));
    }
    if (isPromiseLike(value)) {
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
      const metaValue = metatable.get("__newindex", sf);
      if (isPromiseLike(metaValue)) {
        return metaValue.then((mv: any) =>
          luaCall(mv, [this, key, value], mv.ctx, sf)
        );
      } else {
        return luaCall(
          metaValue,
          [this, key, value],
          (metaValue as any).ctx,
          sf,
        );
      }
    }
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
    return null;
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
      if (hasCall(metaValue)) {
        return metaValue.call(LuaStackFrame.lostFrame, this) as any;
      } else {
        throw new Error("Meta table __tostring must be a function");
      }
    }
    let result = "{";
    let first = true;
    for (const key of this.keys()) {
      if (first) {
        first = false;
      } else result += ", ";
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

export function luaIndexValue(
  value: LuaValue,
  key: LuaValue,
  sf?: LuaStackFrame,
): LuaValue | Promise<LuaValue> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof LuaTable) {
    const rawValue = value.rawGet(key);
    if (rawValue !== undefined && rawValue !== null) {
      return rawValue;
    }
  }

  const metatable = getMetatable(value, sf);
  if (metatable && metatable.has("__index")) {
    const metaValue = metatable.get("__index", sf);
    if (isPromiseLike(metaValue)) {
      return metaValue.then((mv: any) => {
        if (hasCall(mv)) {
          return mv.call(sf!, value, key);
        } else if (mv instanceof LuaTable) {
          return mv.get(key, sf);
        } else {
          throw new Error("Meta table __index must be a function or table");
        }
      });
    } else {
      if (hasCall(metaValue)) {
        return metaValue.call(sf!, value, key);
      } else if (metaValue instanceof LuaTable) {
        return metaValue.get(key, sf);
      } else {
        throw new Error("Meta table __index must be a function or table");
      }
    }
  }
  if (isPlainObject(value) || typeof value === "function") {
    const anyObj = value as Record<any, any>;
    const got = anyObj[key as any];
    return got === undefined || got === null ? null : got;
  }
  return null;
}

export type LuaLValueContainer = { env: ILuaSettable; key: LuaValue };

export async function luaSet(
  obj: any,
  key: any,
  value: any,
  sf: LuaStackFrame,
): Promise<void> {
  if (!obj) {
    throw new LuaRuntimeError(`Not a settable object: nil`, sf);
  }
  if (obj instanceof LuaTable || obj instanceof LuaEnv) {
    await obj.set(key, value, sf);
  } else {
    (obj as Record<any, any>)[key] = value;
  }
}

export function luaGet(
  obj: any,
  key: any,
  sf: LuaStackFrame,
): Promise<any> | any {
  if (obj === null || obj === undefined) {
    throw new LuaRuntimeError(`Attempting to index a nil value`, sf);
  }
  if (key === null || key === undefined) {
    throw new LuaRuntimeError(`Attempting to index with a nil key`, sf);
  }
  if (obj instanceof LuaTable || obj instanceof LuaEnv) {
    return obj.get(key, sf);
  } else if (typeof key === "number") {
    return (obj as any)[key - 1];
  } else if (isPlainObject(obj) || typeof obj === "function") {
    const val = (obj as Record<any, any>)[key];
    if (typeof val === "function") {
      return val.bind(obj);
    } else if (val === undefined) {
      return null;
    } else {
      return val;
    }
  } else {
    return null;
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
  const frame = (sf || LuaStackFrame.lostFrame).withCtx(ctx);
  if (!callee) {
    throw new LuaRuntimeError(`Attempting to call a nil value`, frame);
  }
  if (typeof callee === "function") {
    const jsArgs = evalPromiseValues(
      args.map((v) => luaValueToJS(v, sf || LuaStackFrame.lostFrame)),
    );
    return jsArgs instanceof Promise
      ? jsArgs.then((ja) => callee(...ja))
      : callee(...jsArgs);
  }
  if (callee instanceof LuaTable) {
    const metatable = getMetatable(callee, sf);
    if (metatable && metatable.has("__call")) {
      const metaValue = metatable.get("__call", sf);
      const doCall = (mv: any) => {
        if (hasCall(mv)) {
          return luaCall(mv, [callee, ...args], ctx, sf);
        } else {
          throw new Error("Meta table __call must be a function");
        }
      };
      return isPromiseLike(metaValue)
        ? metaValue.then(doCall)
        : doCall(metaValue);
    }
  }
  if (hasCall(callee)) {
    return callee.call(frame, ...args);
  }
  throw new LuaRuntimeError(
    `Attempting to call a non-callable value of type: ${luaTypeOf(callee)}`,
    frame,
  );
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
  } else if (typeof val === "function" || hasCall(val)) {
    return "function";
  } else if (isPlainObject(val) && (val as any).constructor === Object) {
    return "table";
  } else {
    return "userdata";
  }
}

export class LuaBreak extends Error {}

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

      const lineStart = lastNewline + 1;
      const lineEnd = code.indexOf("\n", ctx.from);
      const codeLine = code.substring(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd,
      );
      const pointer = " ".repeat(column) + "^";

      traceStr += `* ${
        ctx.ref || "(unknown source)"
      } @ ${line}:${column}:\n   ${codeLine}\n   ${pointer}\n`;
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
  if (typeof value === "object" && visited.has(value)) {
    return "<circular reference>";
  }
  if (hasToStringAsync(value)) {
    visited.add(value);
    return value.toStringAsync();
  }
  if (hasAsString(value)) {
    visited.add(value);
    return value.asString();
  }
  if (value instanceof LuaFunction) {
    return `<lua-function (${value.body.parameters.join(", ")})>`;
  }
  if (typeof value === "object") {
    visited.add(value);
    return (async () => {
      let result = "{";
      let first = true;

      if (Array.isArray(value)) {
        for (const val of value) {
          if (first) {
            first = false;
          } else {
            result += ", ";
          }
          const strVal = await luaToString(val, visited);
          result += strVal;
        }
        return result + "}";
      }
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
  } else if (typeof value === "object" && value !== null) {
    const table = new LuaTable();
    for (const key in value) {
      table.set(key, jsToLuaValue((value as any)[key]));
    }
    return table;
  } else if (typeof value === "function") {
    return new LuaNativeJSFunction(value);
  } else {
    return value;
  }
}

export function luaValueToJS(value: any, sf: LuaStackFrame): any {
  if (value instanceof Promise) {
    return value.then((v) => luaValueToJS(v, sf));
  }
  if (value instanceof LuaTable) {
    return value.toJS(sf);
  } else if (
    value instanceof LuaNativeJSFunction ||
    value instanceof LuaFunction ||
    value instanceof LuaBuiltinFunction
  ) {
    return (...args: any[]) => {
      const jsArgs = evalPromiseValues(args.map((v) => luaValueToJS(v, sf)));
      if (jsArgs instanceof Promise) {
        return jsArgs.then((ja) => (value as ILuaFunction).call(sf, ...ja));
      } else {
        return (value as ILuaFunction).call(sf, ...jsArgs);
      }
    };
  } else {
    return value;
  }
}
