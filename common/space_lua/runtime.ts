import type { LuaFunctionBody } from "./ast.ts";
import { evalStatement } from "$common/space_lua/eval.ts";

export class LuaEnv implements ILuaSettable, ILuaGettable {
    variables = new Map<string, LuaValue>();

    constructor(readonly parent?: LuaEnv) {
    }

    setLocal(name: string, value: LuaValue) {
        this.variables.set(name, value);
    }

    set(key: string, value: LuaValue): void {
        if (this.variables.has(key) || !this.parent) {
            this.variables.set(key, value);
        } else {
            this.parent.set(key, value);
        }
    }

    get(name: string): LuaValue | undefined {
        if (this.variables.has(name)) {
            return this.variables.get(name);
        }
        if (this.parent) {
            return this.parent.get(name);
        }
        return undefined;
    }
}

export class LuaMultiRes {
    constructor(readonly values: any[]) {
    }

    unwrap(): any {
        if (this.values.length !== 1) {
            throw new Error("Cannot unwrap multiple values");
        }
        return this.values[0];
    }
}

export function singleResult(value: any): any {
    if (value instanceof LuaMultiRes) {
        return value.unwrap();
    } else {
        return value;
    }
}

// These types are for documentation only
export type LuaValue = any;
export type JSValue = any;

export interface ILuaFunction {
    call(...args: LuaValue[]): Promise<LuaValue> | LuaValue;
}

export interface ILuaSettable {
    set(key: LuaValue, value: LuaValue): void;
}

export interface ILuaGettable {
    get(key: LuaValue): LuaValue | undefined;
}

export class LuaFunction implements ILuaFunction {
    constructor(private body: LuaFunctionBody, private closure: LuaEnv) {
    }

    call(...args: LuaValue[]): Promise<LuaValue> | LuaValue {
        // Create a new environment for this function call
        const env = new LuaEnv(this.closure);
        // Assign the passed arguments to the parameters
        for (let i = 0; i < this.body.parameters.length; i++) {
            let arg = args[i];
            if (arg === undefined) {
                arg = null;
            }
            env.set(this.body.parameters[i], arg);
        }
        return evalStatement(this.body.block, env).catch((e: any) => {
            if (e instanceof LuaReturn) {
                if (e.values.length === 0) {
                    return;
                } else if (e.values.length === 1) {
                    return e.values[0];
                } else {
                    return new LuaMultiRes(e.values);
                }
            } else {
                throw e;
            }
        });
    }
}

export class LuaNativeJSFunction implements ILuaFunction {
    constructor(readonly fn: (...args: JSValue[]) => JSValue) {
    }

    call(...args: LuaValue[]): Promise<LuaValue> | LuaValue {
        const result = this.fn(...args.map(luaValueToJS));
        if (result instanceof Promise) {
            return result.then(jsToLuaValue);
        } else {
            return jsToLuaValue(result);
        }
    }
}

export class LuaTable implements ILuaSettable, ILuaGettable {
    // To optimize the table implementation we use a combination of different data structures
    // When tables are used as maps, the common case is that they are string keys, so we use a simple object for that
    private stringKeys: Record<string, any>;
    // Other keys we can support using a Map as a fallback
    private otherKeys: Map<any, any> | null;
    // When tables are used as arrays, we use a native JavaScript array for that
    private arrayPart: any[];

    // TODO: Actually implement metatables
    private metatable: LuaTable | null;

    constructor() {
        // For efficiency and performance reasons we pre-allocate these (modern JS engines are very good at optimizing this)
        this.stringKeys = {};
        this.arrayPart = [];
        this.otherKeys = null; // Only create this when needed
        this.metatable = null;
    }

    get length(): number {
        return this.arrayPart.length;
    }

    set(key: LuaValue, value: LuaValue) {
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

    get(key: LuaValue): LuaValue | undefined {
        if (typeof key === "string") {
            return this.stringKeys[key];
        } else if (Number.isInteger(key) && key >= 1) {
            return this.arrayPart[key - 1];
        } else if (this.otherKeys) {
            return this.otherKeys.get(key);
        }
        return undefined;
    }

    toArray(): JSValue[] {
        return this.arrayPart;
    }

    toObject(): Record<string, JSValue> {
        const result = { ...this.stringKeys };
        for (const i in this.arrayPart) {
            result[parseInt(i) + 1] = this.arrayPart[i];
        }
        return result;
    }

    static fromArray(arr: JSValue[]): LuaTable {
        const table = new LuaTable();
        for (let i = 0; i < arr.length; i++) {
            table.set(i + 1, arr[i]);
        }
        return table;
    }

    static fromObject(obj: Record<string, JSValue>): LuaTable {
        const table = new LuaTable();
        for (const key in obj) {
            table.set(key, obj[key]);
        }
        return table;
    }
}

export type LuaLValueContainer = { env: ILuaSettable; key: LuaValue };

export function luaSet(obj: any, key: any, value: any) {
    if (obj instanceof LuaTable) {
        obj.set(key, value);
    } else {
        obj[key] = value;
    }
}

export function luaGet(obj: any, key: any): any {
    if (obj instanceof LuaTable) {
        return obj.get(key);
    } else {
        return obj[key];
    }
}

export function luaLen(obj: any): number {
    if (obj instanceof LuaTable) {
        return obj.toArray().length;
    } else if (Array.isArray(obj)) {
        return obj.length;
    } else {
        return 0;
    }
}

export class LuaBreak extends Error {
}

export class LuaReturn extends Error {
    constructor(readonly values: LuaValue[]) {
        super();
    }
}

export function luaTruthy(value: any): boolean {
    if (value === undefined || value === null || value === false) {
        return false;
    }
    if (value instanceof LuaTable) {
        return value.length > 0;
    }
    return true;
}

export function jsToLuaValue(value: any): any {
    if (value instanceof LuaTable) {
        return value;
    } else if (Array.isArray(value)) {
        return LuaTable.fromArray(value.map(jsToLuaValue));
    } else if (typeof value === "object") {
        return LuaTable.fromObject(value);
    } else {
        return value;
    }
}

export function luaValueToJS(value: any): any {
    if (value instanceof LuaTable) {
        // This is a heuristic: if this table is used as an array, we return an array
        if (value.length > 0) {
            return value.toArray();
        } else {
            return value.toObject();
        }
    } else {
        return value;
    }
}
