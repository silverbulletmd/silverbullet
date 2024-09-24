import type { LuaFunctionBody } from "./ast.ts";

export class LuaEnv {
    variables = new Map<string, any>();
    constructor(readonly parent?: LuaEnv) {
    }

    set(name: string, value: any) {
        this.variables.set(name, value);
    }

    get(name: string): any {
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

export interface ILuaFunction {
    call(...args: any[]): Promise<LuaMultiRes> | LuaMultiRes;
}

export class LuaFunction implements ILuaFunction {
    constructor(private body: LuaFunctionBody, private closure: LuaEnv) {
    }

    call(..._args: any[]): Promise<LuaMultiRes> | LuaMultiRes {
        throw new Error("Not yet implemented funciton call");
    }
}

export class LuaNativeJSFunction implements ILuaFunction {
    constructor(readonly fn: (...args: any[]) => any) {
    }

    call(...args: any[]): Promise<LuaMultiRes> | LuaMultiRes {
        const result = this.fn(...args);
        if (result instanceof Promise) {
            return result.then((result) => new LuaMultiRes([result]));
        } else {
            return new LuaMultiRes([result]);
        }
    }
}

export class LuaTable {
    constructor(readonly entries: Map<any, any> = new Map()) {
    }

    get(key: any): any {
        return this.entries.get(key);
    }

    set(key: any, value: any) {
        this.entries.set(key, value);
    }

    /**
     * Convert the table to a a JavaScript array, assuming it uses integer keys
     * @returns
     */
    toArray(): any[] {
        const result = [];
        const keys = Array.from(this.entries.keys()).sort();
        for (const key of keys) {
            result.push(this.entries.get(key));
        }
        return result;
    }

    /**
     * Convert the table to a JavaScript object, assuming it uses string keys
     * @returns
     */
    toObject(): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of this.entries.entries()) {
            result[key] = value;
        }
        return result;
    }
}

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
