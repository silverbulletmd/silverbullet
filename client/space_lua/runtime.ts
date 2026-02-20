import type { ASTCtx, LuaFunctionBody, NumericType } from "./ast.ts";
import { evalStatement } from "./eval.ts";
import { asyncQuickSort } from "./util.ts";
import { isPromise, rpAll } from "./rp.ts";
import { isNegativeZero, isTaggedFloat } from "./numeric.ts";
import { luaFormat } from "./stdlib/format.ts";

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
  set(
    key: LuaValue,
    value: LuaValue,
    sf?: LuaStackFrame,
    numType?: NumericType,
  ): void | Promise<void>;
}

export interface ILuaGettable {
  get(key: LuaValue, sf?: LuaStackFrame): LuaValue | Promise<LuaValue> | null;
  getNumericType?(key: LuaValue): NumericType | undefined;
}

// Small helpers for type safety/readability
export function isILuaFunction(v: unknown): v is ILuaFunction {
  return !!v && typeof (v as any).call === "function";
}

export function isLuaTable(v: unknown): v is LuaTable {
  return v instanceof LuaTable;
}

export function toNumKey(key: unknown): string | number {
  if (isTaggedFloat(key)) {
    return key.value;
  }
  if (typeof key === "number" || typeof key === "string") {
    return key;
  }
  return key as unknown as string | number;
}

export function ctxOrNull(sf?: LuaStackFrame): ASTCtx | null {
  return sf?.astCtx ?? null;
}

// Reuse a single empty context to avoid allocating `{}` in hot paths
const EMPTY_CTX = {} as ASTCtx;

const MAX_TAG_LOOP = 200;

// Close-stack support
export type LuaCloseEntry = { value: LuaValue; ctx: ASTCtx };

type LuaThreadState = {
  closeStack?: LuaCloseEntry[];
};

function isLuaNumber(v: any): boolean {
  return typeof v === "number" || isTaggedFloat(v);
}

export function luaTypeName(val: any): LuaType {
  if (val === null || val === undefined) {
    return "nil";
  }

  const t = luaTypeOf(val);

  if (typeof t === "string") {
    return t;
  }

  const ty = typeof val;
  if (ty === "number") {
    return "number";
  }
  if (ty === "string") {
    return "string";
  }
  if (ty === "boolean") {
    return "boolean";
  }
  if (ty === "function") {
    return "function";
  }
  if (Array.isArray(val)) {
    return "table";
  }
  if (ty === "object" && (val as any).constructor === Object) {
    return "table";
  }

  return "userdata";
}

// Check whether a value is callable without invoking it.
export function luaIsCallable(
  v: LuaValue,
  sf: LuaStackFrame,
): boolean {
  if (v === null || v === undefined) {
    return false;
  }
  if (typeof v === "function") {
    return true;
  }
  if (isILuaFunction(v)) {
    return true;
  }
  if (v instanceof LuaTable) {
    const mt = getMetatable(v, sf);
    if (mt && mt.has("__call")) {
      const mm = mt.get("__call", sf);
      return !!mm && (typeof mm === "function" || isILuaFunction(mm));
    }
  }
  return false;
}

// In Lua, `__close` must be a function (no `__call` fallback).
function luaIsCloseMethod(
  v: LuaValue,
): boolean {
  return typeof v === "function" || isILuaFunction(v);
}

export function luaEnsureCloseStack(sf: LuaStackFrame): LuaCloseEntry[] {
  if (!sf.threadState.closeStack) {
    sf.threadState.closeStack = [];
  }
  return sf.threadState.closeStack as LuaCloseEntry[];
}

export function luaMarkToBeClosed(
  sf: LuaStackFrame,
  value: LuaValue,
  ctx: ASTCtx,
): void {
  const closeStack = luaEnsureCloseStack(sf);

  // In Lua, `nil` is not closed.
  if (value === null) {
    return;
  }

  const mt = getMetatable(value, sf);
  if (!mt || !mt.has("__close")) {
    throw new LuaRuntimeError(
      "variable got a non-closable value",
      sf.withCtx(ctx),
    );
  }

  const mm = mt.get("__close");
  if (!luaIsCloseMethod(mm)) {
    throw new LuaRuntimeError(
      "variable got a non-closable value",
      sf.withCtx(ctx),
    );
  }

  closeStack.push({ value, ctx });
}

// Close entries from a mark (LIFO) and shrink stack back to mark.  This
// is the core semantic for block exits and protected call boundaries.
export function luaCloseFromMark(
  sf: LuaStackFrame,
  mark: number,
  errObj: LuaValue | null,
): Promise<void> | void {
  const closeStack = sf.threadState?.closeStack as LuaCloseEntry[] | undefined;
  if (!closeStack) {
    return;
  }
  if (closeStack.length <= mark) {
    return;
  }

  const callClose = (entry: LuaCloseEntry): LuaValue | Promise<LuaValue> => {
    const mt = getMetatable(entry.value, sf);
    const mm = mt ? mt.get("__close", sf) : null;
    if (!luaIsCloseMethod(mm)) {
      throw new LuaRuntimeError(
        "metamethod '__close' is not callable",
        sf.withCtx(entry.ctx),
      );
    }
    if (errObj === null) {
      return luaCall(mm, [entry.value], entry.ctx, sf);
    }
    return luaCall(mm, [entry.value, errObj], entry.ctx, sf);
  };

  // Close all to-be-closed variables (LIFO) even if one close errors.
  // The reported error should be the first close error encountered.
  const runFrom = (i: number): void | Promise<void> => {
    let firstErr: unknown | null = null;

    const recordErr = (e: unknown) => {
      if (firstErr === null) {
        firstErr = e;
      }
    };

    const next = (idx: number): void | Promise<void> => {
      for (let j = idx; j >= mark; j--) {
        let r: LuaValue | Promise<LuaValue>;
        try {
          r = callClose(closeStack[j]);
        } catch (e) {
          recordErr(e);
          continue;
        }

        if (isPromise(r)) {
          return (r as Promise<any>).then(
            () => next(j - 1),
            (e: any) => {
              recordErr(e);
              return next(j - 1);
            },
          );
        }
      }

      closeStack.length = mark;
      if (firstErr !== null) {
        throw firstErr;
      }
    };

    return next(i);
  };

  return runFrom(closeStack.length - 1);
}

export class LuaEnv implements ILuaSettable, ILuaGettable {
  variables = new Map<string, LuaValue>();

  private readonly consts = new Set<string>();
  private readonly numericTypes = new Map<string, NumericType>();

  constructor(readonly parent?: LuaEnv) {
  }

  setLocal(name: string, value: LuaValue, numType?: NumericType) {
    this.variables.set(name, value);
    if (isLuaNumber(value) && numType) {
      this.numericTypes.set(name, numType);
    } else {
      this.numericTypes.delete(name);
    }
  }

  setLocalConst(name: string, value: LuaValue, numType?: NumericType) {
    this.variables.set(name, value);
    this.consts.add(name);
    if (isLuaNumber(value) && numType) {
      this.numericTypes.set(name, numType);
    } else {
      this.numericTypes.delete(name);
    }
  }

  set(
    key: string,
    value: LuaValue,
    sf?: LuaStackFrame,
    numType?: NumericType,
  ): void {
    if (this.variables.has(key) || !this.parent) {
      if (this.consts.has(key)) {
        throw new LuaRuntimeError(
          `attempt to assign to const variable '${key}'`,
          sf || LuaStackFrame.lostFrame,
        );
      }
      this.variables.set(key, value);
      if (isLuaNumber(value) && numType) {
        this.numericTypes.set(key, numType);
      } else {
        this.numericTypes.delete(key);
      }
    } else {
      this.parent.set(key, value, sf, numType);
    }
  }

  getNumericType(name: string): NumericType | undefined {
    if (this.numericTypes.has(name)) {
      return this.numericTypes.get(name);
    }
    if (this.parent) {
      return this.parent.getNumericType(name);
    }
    return undefined;
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
    _sf?: LuaStackFrame,
  ): Promise<LuaValue> | LuaValue | null {
    if (this.variables.has(name)) {
      return this.variables.get(name);
    }
    if (this.parent) {
      return this.parent.get(name, _sf);
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
  // Must not share mutable per-thread state across calls/tests. This is
  // a getter that returns a fresh frame each time.
  static get lostFrame(): LuaStackFrame {
    return new LuaStackFrame(new LuaEnv(), null, undefined, undefined, {
      closeStack: undefined,
    });
  }

  constructor(
    readonly threadLocal: LuaEnv,
    readonly astCtx: ASTCtx | null,
    readonly parent?: LuaStackFrame,
    readonly currentFunction?: LuaFunction,
    readonly threadState: LuaThreadState = { closeStack: undefined },
  ) {
  }

  static createWithGlobalEnv(
    globalEnv: LuaEnv,
    ctx: ASTCtx | null = null,
  ): LuaStackFrame {
    const env = new LuaEnv();
    env.setLocal("_GLOBAL", globalEnv);
    return new LuaStackFrame(env, ctx, undefined, undefined, {
      closeStack: undefined,
    });
  }

  withCtx(ctx: ASTCtx): LuaStackFrame {
    return new LuaStackFrame(
      this.threadLocal,
      ctx,
      this,
      this.currentFunction,
      this.threadState,
    );
  }

  withFunction(fn: LuaFunction): LuaStackFrame {
    return new LuaStackFrame(
      this.threadLocal,
      this.astCtx,
      this.parent,
      fn,
      this.threadState,
    );
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
  }
  return value;
}

export class LuaFunction implements ILuaFunction {
  private capturedEnv: LuaEnv;
  funcHasGotos?: boolean;

  constructor(readonly body: LuaFunctionBody, closure: LuaEnv) {
    this.capturedEnv = closure;
  }

  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue {
    // Create a new environment that chains to the captured environment
    const env = new LuaEnv(this.capturedEnv);
    if (!sf) {
      console.trace(sf);
    }
    // Set _CTX to the thread local environment from the stack frame
    env.setLocal("_CTX", sf.threadLocal);

    // Eval using a stack frame that knows the current function
    const sfWithFn = sf.currentFunction === this ? sf : sf.withFunction(this);

    // Resolve args (sync-first)
    const argsRP = rpAll(args as any[]);
    const resolveArgs = (resolvedArgs: any[]) => {
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

      // Evaluate the function body with returnOnReturn set to true
      const r = evalStatement(this.body.block, env, sfWithFn, true);

      const map = (val: any) => {
        if (val === undefined) {
          return;
        }
        if (val && typeof val === "object" && val.ctrl === "return") {
          return mapFunctionReturnValue(val.values);
        }
        if (val && typeof val === "object" && val.ctrl === "break") {
          throw new LuaRuntimeError(
            "break outside loop",
            sfWithFn.withCtx(this.body.block.ctx),
          );
        }
        if (val && typeof val === "object" && val.ctrl === "goto") {
          throw new LuaRuntimeError(
            "unexpected goto signal",
            sfWithFn.withCtx(this.body.block.ctx),
          );
        }
      };

      if (isPromise(r)) {
        return r.then(map);
      }
      return map(r);
    };

    if (isPromise(argsRP)) {
      return argsRP.then(resolveArgs);
    }
    return resolveArgs(argsRP);
  }

  asString(): string {
    return `<lua function(${this.body.parameters.join(", ")})>`;
  }

  toString(): string {
    return this.asString();
  }
}

function mapFunctionReturnValue(values: any[]): any {
  if (values.length === 0) {
    return;
  }

  if (values.length === 1) {
    return values[0];
  }

  return new LuaMultiRes(values);
}

export class LuaNativeJSFunction implements ILuaFunction {
  constructor(readonly fn: (...args: JSValue[]) => JSValue) {
  }

  // Performs automatic conversion between Lua and JS values for arguments, but not for return values
  call(sf: LuaStackFrame, ...args: LuaValue[]): Promise<LuaValue> | LuaValue {
    const jsArgsRP = args.map((v) => luaValueToJS(v, sf));
    const resolved = rpAll(jsArgsRP);
    if (isPromise(resolved)) {
      return resolved.then((jsArgs) => this.fn(...jsArgs));
    }
    return this.fn(...resolved);
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

  // Numeric type metadata at storage boundaries
  private readonly stringKeyTypes = new Map<string, NumericType>();
  private otherKeyTypes: Map<any, NumericType> | null = null;
  private readonly arrayTypes: (NumericType | undefined)[] = [];

  constructor(init?: any[] | Record<string, any>) {
    // For efficiency and performance reasons we pre-allocate these (modern JS engines are very good at optimizing this)
    this.arrayPart = Array.isArray(init) ? init : [];
    this.stringKeys = init && !Array.isArray(init) ? init : {};

    if (init && !Array.isArray(init)) {
      for (const k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k)) {
          this.stringKeys[k] = (init as any)[k];
        }
      }
    }
    this.otherKeys = null; // Only create this when needed
    this.metatable = null;
  }

  private static numKeyValue(key: any): number | null {
    if (isTaggedFloat(key)) {
      return key.value;
    }
    if (typeof key === "number") {
      return key;
    }
    return null;
  }

  // Normalize numeric keys for table indexing:
  // * negative zero becomes positive zero,
  // * integer-valued floats become plain integers,
  // * non-integer floats stay as-is.
  static normalizeNumericKey(key: any): any {
    if (typeof key === "string") {
      return key;
    }

    const numVal = LuaTable.numKeyValue(key);
    if (numVal !== null) {
      // Normalize -0 to +0
      if (isNegativeZero(numVal)) {
        return 0;
      }
      // Integer-valued numbers normalize to integers
      if (Number.isInteger(numVal)) {
        return numVal;
      }
      // Non-integer floats
      return numVal;
    }
    return key;
  }

  private static isIntegerKey(key: any): boolean {
    const norm = LuaTable.normalizeNumericKey(key);
    return typeof norm === "number" && Number.isInteger(norm) && norm >= 1;
  }

  private static toIndex(key: any): number {
    const norm = LuaTable.normalizeNumericKey(key);
    const k = typeof norm === "number" ? norm : (norm as number);
    return k - 1;
  }

  get rawLength(): number {
    return this.arrayPart.length;
  }

  get length(): number {
    let n = this.arrayPart.length;
    while (n > 0) {
      const v = this.arrayPart[n - 1];
      if (v === null || v === undefined) {
        n--;
        continue;
      }
      break;
    }
    return n;
  }

  keys(): any[] {
    const keys: any[] = [];
    for (const k in this.stringKeys) {
      if (Object.prototype.hasOwnProperty.call(this.stringKeys, k)) {
        keys.push(k);
      }
    }
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

  empty(): boolean {
    for (const k in this.stringKeys) {
      if (Object.prototype.hasOwnProperty.call(this.stringKeys, k)) {
        return false;
      }
    }
    if (this.arrayPart.length !== 0) {
      return false;
    }
    if (this.otherKeys && this.otherKeys.size !== 0) {
      return false;
    }
    return true;
  }

  has(key: LuaValue) {
    if (typeof key === "string") {
      return this.stringKeys[key] !== undefined;
    }

    const normalizedKey = LuaTable.normalizeNumericKey(key);

    if (
      typeof normalizedKey === "number" && Number.isInteger(normalizedKey) &&
      normalizedKey >= 1
    ) {
      const idx = normalizedKey - 1;
      const v = this.arrayPart[idx];
      if (v !== undefined) {
        return true;
      }
      return this.otherKeys ? this.otherKeys.has(normalizedKey) : false;
    }
    if (typeof normalizedKey === "string") {
      return this.stringKeys[normalizedKey] !== undefined;
    }
    if (this.otherKeys) {
      return this.otherKeys.has(normalizedKey);
    }

    return false;
  }

  // Used by table constructors to preserve positional semantics
  // including nils and ensure the array part grows to the final
  // constructor size.
  rawSetArrayIndex(
    index1: number,
    value: LuaValue,
    numType?: NumericType,
  ): void {
    const idx = index1 - 1;

    this.arrayPart[idx] = value;
    if (isLuaNumber(value) && numType) {
      this.arrayTypes[idx] = numType;
    } else {
      this.arrayTypes[idx] = undefined;
    }
  }

  private promoteIntegerKeysFromHash(): void {
    if (!this.otherKeys) return;

    while (true) {
      const nextIndex1 = this.arrayPart.length + 1;
      if (!this.otherKeys.has(nextIndex1)) {
        break;
      }

      const v = this.otherKeys.get(nextIndex1);
      const nt = this.otherKeyTypes
        ? this.otherKeyTypes.get(nextIndex1)
        : undefined;

      this.otherKeys.delete(nextIndex1);
      if (this.otherKeyTypes) {
        this.otherKeyTypes.delete(nextIndex1);
      }

      this.arrayPart.push(v);
      this.arrayTypes.push(nt);
    }
  }

  rawSet(
    key: LuaValue,
    value: LuaValue,
    numType?: NumericType,
  ): void | Promise<void> {
    if (isPromise(key)) {
      return key.then((key) => this.rawSet(key, value, numType));
    }
    if (isPromise(value)) {
      return value.then((v) => this.rawSet(key, v, numType));
    }

    // Fast path: string keys (the dominant case)
    if (typeof key === "string") {
      if (value === null || value === undefined) {
        delete this.stringKeys[key];
        this.stringKeyTypes.delete(key);
      } else {
        this.stringKeys[key] = value;
        if (isLuaNumber(value) && numType) {
          this.stringKeyTypes.set(key, numType);
        } else {
          this.stringKeyTypes.delete(key);
        }
      }
      return;
    }

    const normalizedKey = LuaTable.normalizeNumericKey(key);

    if (typeof normalizedKey === "string") {
      if (value === null || value === undefined) {
        delete this.stringKeys[normalizedKey];
        this.stringKeyTypes.delete(normalizedKey);
      } else {
        this.stringKeys[normalizedKey] = value;
        if (isLuaNumber(value) && numType) {
          this.stringKeyTypes.set(normalizedKey, numType);
        } else {
          this.stringKeyTypes.delete(normalizedKey);
        }
      }
      return;
    }

    if (
      typeof normalizedKey === "number" && Number.isInteger(normalizedKey) &&
      normalizedKey >= 1
    ) {
      const idx = normalizedKey - 1;

      // Sparse writes (e.g. `a[7]=4` when length is 3) go to the hash
      // part so that `#a` does not jump across holes.
      if (idx <= this.arrayPart.length) {
        this.arrayPart[idx] = value;
        if (isLuaNumber(value) && numType) {
          this.arrayTypes[idx] = numType;
        } else {
          this.arrayTypes[idx] = undefined;
        }

        // If we extended the array by appending, we may now be able to
        // promote subsequent integer keys from the hash part.
        if (idx === this.arrayPart.length - 1) {
          this.promoteIntegerKeysFromHash();
        }

        // Trailing nil shrink
        if (value === null || value === undefined) {
          let n = this.arrayPart.length;
          while (n > 0) {
            const v = this.arrayPart[n - 1];
            if (v === null || v === undefined) {
              n--;
              continue;
            }
            break;
          }
          if (n !== this.arrayPart.length) {
            this.arrayPart.length = n;
            this.arrayTypes.length = n;
          }
        }

        return;
      }

      // Sparse numeric key
      if (!this.otherKeys) {
        this.otherKeys = new Map();
      }
      if (!this.otherKeyTypes) {
        this.otherKeyTypes = new Map();
      }

      if (value === null || value === undefined) {
        this.otherKeys.delete(normalizedKey);
        this.otherKeyTypes.delete(normalizedKey);
      } else {
        this.otherKeys.set(normalizedKey, value);
        if (isLuaNumber(value) && numType) {
          this.otherKeyTypes.set(normalizedKey, numType);
        } else {
          this.otherKeyTypes.delete(normalizedKey);
        }
      }
      return;
    }

    if (!this.otherKeys) {
      this.otherKeys = new Map();
    }
    if (!this.otherKeyTypes) {
      this.otherKeyTypes = new Map();
    }

    if (value === null || value === undefined) {
      this.otherKeys.delete(normalizedKey);
      this.otherKeyTypes.delete(normalizedKey);
    } else {
      this.otherKeys.set(normalizedKey, value);
      if (isLuaNumber(value) && numType) {
        this.otherKeyTypes.set(normalizedKey, numType);
      } else {
        this.otherKeyTypes.delete(normalizedKey);
      }
    }
  }

  set(
    key: LuaValue,
    value: LuaValue,
    sf?: LuaStackFrame,
    numType?: NumericType,
  ): Promise<void> | void {
    const errSf = sf || LuaStackFrame.lostFrame;
    const ctx = sf?.astCtx ?? EMPTY_CTX;

    if (key === null || key === undefined) {
      throw new LuaRuntimeError(
        "table index is nil",
        errSf,
      );
    }

    if (typeof key === "number" && isNaN(key)) {
      throw new LuaRuntimeError(
        "table index is NaN",
        errSf,
      );
    }

    if (this.has(key)) {
      return this.rawSet(key, value, numType);
    }

    if (this.metatable === null) {
      return this.rawSet(key, value, numType);
    }

    const newIndexMM = this.metatable.rawGet("__newindex");

    if (newIndexMM === undefined || newIndexMM === null) {
      return this.rawSet(key, value, numType);
    }

    const k: LuaValue = key;
    const v: LuaValue = value;
    const nt: NumericType | undefined = numType;

    let target: LuaValue | null = null;

    for (let loop = 0; loop < MAX_TAG_LOOP; loop++) {
      const t = target === null ? this : target;

      if (t instanceof LuaTable) {
        if (t.has(k)) {
          return t.rawSet(k, v, nt);
        }

        const mt = t.metatable;
        if (!mt) {
          return t.rawSet(k, v, nt);
        }

        const mm = mt.rawGet("__newindex");
        const hasMM = !(mm === undefined || mm === null);

        if (!hasMM) {
          return t.rawSet(k, v, nt);
        }

        // Function metamethod: call and stop
        if (typeof mm === "function" || isILuaFunction(mm)) {
          return luaCall(mm, [t, k, v], ctx, errSf);
        }

        // Table/env metamethod: forward assignment
        if (mm instanceof LuaTable || mm instanceof LuaEnv) {
          target = mm;
          continue;
        }

        const ty = luaTypeOf(mm) as any as string;
        throw new LuaRuntimeError(
          `attempt to index a ${ty} value`,
          errSf.withCtx(ctx),
        );
      }

      const ty = luaTypeOf(t) as any as string;
      throw new LuaRuntimeError(
        `attempt to index a ${ty} value`,
        errSf.withCtx(ctx),
      );
    }

    throw new LuaRuntimeError(
      "'__newindex' chain too long; possible loop",
      errSf.withCtx(ctx),
    );
  }

  getNumericType(key: LuaValue): NumericType | undefined {
    if (typeof key === "string") {
      return this.stringKeyTypes.get(key);
    }
    if (LuaTable.isIntegerKey(key)) {
      return this.arrayTypes[LuaTable.toIndex(key)];
    }
    if (this.otherKeyTypes) {
      return this.otherKeyTypes.get(key);
    }
    return undefined;
  }

  rawGet(key: LuaValue): LuaValue | null {
    if (typeof key === "string") {
      return this.stringKeys[key];
    }

    const normalizedKey = LuaTable.normalizeNumericKey(key);

    if (typeof normalizedKey === "string") {
      return this.stringKeys[normalizedKey];
    }

    if (
      typeof normalizedKey === "number" && Number.isInteger(normalizedKey) &&
      normalizedKey >= 1
    ) {
      const idx = normalizedKey - 1;
      const v = this.arrayPart[idx];
      if (v !== undefined) {
        return v;
      }
      // Sparse integer keys can live in the hash part.
      if (this.otherKeys) {
        return this.otherKeys.get(normalizedKey);
      }
      return undefined;
    }

    if (this.otherKeys) {
      return this.otherKeys.get(normalizedKey);
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
    }
    return this.toJSObject(sf);
  }

  async toStringAsync(): Promise<string> {
    const metatable = getMetatable(this);
    if (metatable) {
      const mm = metatable.rawGet("__tostring");
      if (!(mm === undefined || mm === null)) {
        const ctx = EMPTY_CTX;
        const sf = LuaStackFrame.lostFrame.withCtx(ctx);

        const r = luaCall(mm, [this], ctx, sf);
        const v = isPromise(r) ? await r : r;

        const s = singleResult(v);
        if (typeof s !== "string") {
          throw new LuaRuntimeError(
            "'__tostring' must return a string",
            sf,
          );
        }
        return s;
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
  // `nil` handling is done by luaGet() which has better context;
  // keep this defensive for direct callers.
  if (value === null || value === undefined) {
    return null;
  }

  const errSf = sf || LuaStackFrame.lostFrame;
  const ctx = sf?.astCtx ?? EMPTY_CTX;

  let t: LuaValue = value;

  for (let loop = 0; loop < MAX_TAG_LOOP; loop++) {
    // Primitive get when table
    if (t instanceof LuaTable) {
      const raw = t.rawGet(key);
      if (raw !== undefined) {
        return raw;
      }
      // If no metatable, raw miss => nil
      if (t.metatable === null) {
        return null;
      }
    }

    const mt = getMetatable(t, errSf);
    const mm = mt ? mt.rawGet("__index") : null;

    if (mm === undefined || mm === null) {
      // Strict Lua: only tables are indexable without a metamethod.
      // For a table, raw miss yields nil; for non-table, it's a type error.
      if (t instanceof LuaTable) {
        return null;
      }
      const ty = luaTypeOf(t) as any as string;
      throw new LuaRuntimeError(
        `attempt to index a ${ty} value`,
        errSf.withCtx(ctx),
      );
    }

    // Function metamethod
    if (typeof mm === "function" || isILuaFunction(mm)) {
      return luaCall(mm, [t, key], ctx, errSf);
    }

    // Table/metatable delegation: repeat with mm as new "t"
    if (mm instanceof LuaTable || mm instanceof LuaEnv) {
      t = mm;
      continue;
    }

    // Bad metamethod type: make it a Lua-like type error
    const ty = luaTypeOf(mm) as any as string;
    throw new LuaRuntimeError(
      `attempt to index a ${ty} value`,
      errSf.withCtx(ctx),
    );
  }

  throw new LuaRuntimeError(
    "'__index' chain too long; possible loop",
    errSf.withCtx(ctx),
  );
}

export type LuaLValueContainer = { env: ILuaSettable; key: LuaValue };

export async function luaSet(
  obj: any,
  key: any,
  value: any,
  sf: LuaStackFrame,
  numType?: NumericType,
): Promise<void> {
  if (!obj) {
    throw new LuaRuntimeError(
      `Not a settable object: nil`,
      sf,
    );
  }

  const normKey = isTaggedFloat(key) ? key.value : key;

  if (obj instanceof LuaTable || obj instanceof LuaEnv) {
    await obj.set(normKey, value, sf, numType);
  } else {
    const k = toNumKey(normKey);
    (obj as Record<string | number, any>)[k] = await luaValueToJS(value, sf);
  }
}

export function luaGet(
  obj: any,
  key: any,
  ctx: ASTCtx | null,
  sf: LuaStackFrame,
): Promise<any> | any {
  const errSf = ctx ? sf.withCtx(ctx) : sf;

  if (obj === null || obj === undefined) {
    throw new LuaRuntimeError(
      `attempt to index a nil value`,
      errSf,
    );
  }

  // In Lua reading with a nil key returns nil silently
  if (key === null || key === undefined) {
    return null;
  }

  if (obj instanceof LuaTable || obj instanceof LuaEnv) {
    return obj.get(key, sf);
  }
  if (typeof key === "number") {
    return (obj as any[])[key - 1];
  }
  if (isTaggedFloat(key)) {
    return (obj as any[])[key.value - 1];
  }
  // Native JS object
  const k = toNumKey(key);
  const val = (obj as Record<string | number, any>)[k];
  if (typeof val === "function") {
    // Automatically bind the function to the object
    return val.bind(obj);
  }
  if (val === undefined) {
    return null;
  }
  return val;
}

export function luaLen(
  obj: any,
  sf?: LuaStackFrame,
  raw = false,
): number | Promise<number> {
  if (typeof obj === "string") {
    return obj.length;
  }
  if (Array.isArray(obj)) {
    return obj.length;
  }
  if (obj instanceof LuaTable) {
    // Check __len metamethod unless raw access is requested
    if (!raw) {
      const mt = getMetatable(obj, sf || LuaStackFrame.lostFrame);
      const mm = mt ? mt.rawGet("__len") : null;
      if (mm !== undefined && mm !== null) {
        const r = luaCall(mm, [obj], (sf?.astCtx ?? {}) as ASTCtx, sf);
        if (isPromise(r)) {
          return (r as Promise<any>).then((v: any) => Number(singleResult(v)));
        }
        return Number(singleResult(r));
      }
    }
    return obj.rawLength;
  }

  const t = luaTypeOf(obj) as LuaType;
  throw new LuaRuntimeError(
    `bad argument #1 to 'rawlen' (table or string expected, got ${t})`,
    sf || LuaStackFrame.lostFrame,
  );
}

export function luaCall(
  callee: any,
  args: any[],
  ctx: ASTCtx,
  sf?: LuaStackFrame,
): any {
  if (!callee) {
    throw new LuaRuntimeError(
      `attempt to call a nil value`,
      (sf || LuaStackFrame.lostFrame).withCtx(ctx),
    );
  }

  // Fast path: native JS function
  if (typeof callee === "function") {
    const jsArgs = rpAll(
      args.map((v) => luaValueToJS(v, sf || LuaStackFrame.lostFrame)),
    );

    if (isPromise(jsArgs)) {
      return jsArgs.then((resolved) =>
        (callee as (...a: any[]) => any)(...resolved)
      );
    }
    return (callee as (...a: any[]) => any)(...jsArgs);
  }

  // Lua table: may be callable via __call metamethod
  if (callee instanceof LuaTable) {
    const metatable = getMetatable(callee, sf);

    // Metamethod lookup must be raw (no __index involvement).
    const mm = metatable ? metatable.rawGet("__call") : null;

    if (!(mm === undefined || mm === null)) {
      const isCallable = (v: any): boolean => {
        if (v === null || v === undefined) return false;
        if (typeof v === "function") return true;
        if (isILuaFunction(v)) return true;
        if (v instanceof LuaTable) {
          const mt2 = getMetatable(v, sf);
          const mm2 = mt2 ? mt2.rawGet("__call") : null;
          return !(mm2 === undefined || mm2 === null);
        }
        return false;
      };

      if (!isCallable(mm)) {
        throw new LuaRuntimeError(
          `attempt to call a ${luaTypeOf(mm)} value`,
          (sf || LuaStackFrame.lostFrame).withCtx(ctx),
        );
      }

      return luaCall(mm, [callee, ...args], ctx, sf);
    }
  }

  // ILuaFunction (LuaFunction/LuaBuiltinFunction/LuaNativeJSFunction/etc.)
  if (isILuaFunction(callee)) {
    const base = (sf || LuaStackFrame.lostFrame).withCtx(ctx);
    const frameForCall = callee instanceof LuaFunction
      ? base.withFunction(callee)
      : base;
    return callee.call(
      frameForCall,
      ...args,
    );
  }

  throw new LuaRuntimeError(
    `attempt to call a non-callable value of type: ${luaTypeOf(callee)}`,
    (sf || LuaStackFrame.lostFrame).withCtx(ctx),
  );
}

export function luaEquals(a: any, b: any): boolean {
  const an = isTaggedFloat(a) ? a.value : a;
  const bn = isTaggedFloat(b) ? b.value : b;
  return an === bn;
}

export function luaKeys(val: any): any[] {
  if (val instanceof LuaTable) {
    return val.keys();
  }
  if (Array.isArray(val)) {
    return val.map((_, i) => i + 1);
  }
  return Object.keys(val);
}

export function luaTypeOf(val: any): LuaType | Promise<LuaType> {
  if (val === null || val === undefined) {
    return "nil";
  }
  if (isPromise(val)) {
    return (val as Promise<any>).then((v) => luaTypeOf(v));
  }
  if (typeof val === "boolean") {
    return "boolean";
  }
  if (typeof val === "number") {
    return "number";
  }
  if (isTaggedFloat(val)) {
    return "number";
  }
  if (typeof val === "string") {
    return "string";
  }
  if (val instanceof LuaTable) {
    return "table";
  }
  if (Array.isArray(val)) {
    return "table";
  }
  if (typeof val === "function" || isILuaFunction(val)) {
    return "function";
  }
  if (typeof val === "object" && (val as any).constructor === Object) {
    return "table";
  }
  return "userdata";
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

  if (typeof value === "object" && value instanceof LuaMultiRes) {
    // for multi-return values, only the first result determines truthiness
    const first = value.unwrap();
    return !(first === null || first === undefined || first === false);
  }

  // all non-`nil`/non-`false` values are truthy (including empty tables)
  return true;
}

export function luaToString(
  value: any,
  visited: Set<any> = new Set(),
): string | Promise<string> {
  if (value === null || value === undefined) {
    return "nil";
  }
  if (isPromise(value)) {
    return (value as Promise<any>).then((v) => luaToString(v, visited));
  }

  if (isTaggedFloat(value)) {
    return luaFormatNumber(value.value, "float");
  }

  if (typeof value === "number") {
    return luaFormatNumber(value);
  }

  // Check for circular references
  if (typeof value === "object" && visited.has(value)) {
    return "<circular reference>";
  }
  if ((value as any).toStringAsync) {
    // Add to visited before recursing
    visited.add(value);
    return (value as any).toStringAsync();
  }
  if ((value as any).asString) {
    visited.add(value);
    return (value as any).asString();
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

export function luaFormatNumber(n: number, kind?: "int" | "float"): string {
  if (kind !== "float" && Number.isInteger(n) && isFinite(n)) {
    return String(n);
  }
  if (n !== n) return "-nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (n === 0) {
    return (1 / n === -Infinity) ? "-0.0" : "0.0";
  }
  // Delegate to luaFormat for `%.14g`
  const s = luaFormat("%.14g", n);
  // Guarantee `.01 suffix for integer-valued floats
  if (s.indexOf(".") === -1 && s.indexOf("e") === -1) {
    return s + ".0";
  }
  return s;
}

export function getMetatable(
  value: LuaValue,
  sf?: LuaStackFrame,
): LuaTable | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    // Prefer per-thread cached string metatable if `_GLOBAL` available
    const thread = sf?.threadLocal;
    const globalEnv = thread?.get("_GLOBAL") as LuaEnv | null | undefined;

    if (thread && globalEnv instanceof LuaEnv) {
      const cached = thread.get("_STRING_MT") as LuaTable | undefined;
      if (cached instanceof LuaTable) {
        return cached;
      }

      const stringMetatable = new LuaTable();
      stringMetatable.set("__index", (globalEnv as any).get("string"));
      thread.setLocal("_STRING_MT", stringMetatable);

      return stringMetatable;
    }

    return null;
  }

  if ((value as any).metatable) {
    return (value as any).metatable as LuaTable;
  }
  return null;
}

export function jsToLuaValue(value: any): any {
  if (isPromise(value)) {
    return (value as Promise<any>).then(jsToLuaValue);
  }
  if (value instanceof LuaTable) {
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return value;
  }
  if (Array.isArray(value) && "index" in value && "input" in value) {
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
  }
  if (Array.isArray(value)) {
    const table = new LuaTable();
    for (let i = 0; i < value.length; i++) {
      table.set(i + 1, jsToLuaValue(value[i]));
    }
    return table;
  }
  if (typeof value === "object") {
    const table = new LuaTable();
    for (const key in value) {
      table.set(key, jsToLuaValue((value as any)[key]));
    }
    return table;
  }
  if (typeof value === "function") {
    return new LuaNativeJSFunction(value);
  }
  return value;
}

// Inverse of jsToLuaValue
export function luaValueToJS(value: any, sf: LuaStackFrame): any {
  if (isPromise(value)) {
    return (value as Promise<any>).then((v) => luaValueToJS(v, sf));
  }
  if (value instanceof LuaTable) {
    return value.toJS(sf);
  }
  if (
    value instanceof LuaNativeJSFunction || value instanceof LuaFunction ||
    value instanceof LuaBuiltinFunction
  ) {
    return (...args: any[]) => {
      const jsArgs = rpAll(
        args.map((v) => luaValueToJS(v, sf)),
      );
      if (isPromise(jsArgs)) {
        return luaValueToJS(
          jsArgs.then((jsArgs) => (value as ILuaFunction).call(sf, ...jsArgs)),
          sf,
        );
      }
      return luaValueToJS((value as ILuaFunction).call(sf, ...jsArgs), sf);
    };
  }
  if (isTaggedFloat(value)) {
    return value.value;
  }
  return value;
}
