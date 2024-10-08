import {
    type ILuaFunction,
    LuaBuiltinFunction,
    LuaEnv,
    LuaMultiRes,
    LuaTable,
    luaToString,
    luaTypeOf,
    type LuaValue,
} from "$common/space_lua/runtime.ts";

const printFunction = new LuaBuiltinFunction((...args) => {
    console.log("[Lua]", ...args.map(luaToString));
});

const assertFunction = new LuaBuiltinFunction(
    async (value: any, message?: string) => {
        if (!await value) {
            throw new Error(`Assertion failed: ${message}`);
        }
    },
);

const ipairsFunction = new LuaBuiltinFunction((ar: LuaTable) => {
    let i = 1;
    return () => {
        if (i > ar.length) {
            return;
        }
        const result = new LuaMultiRes([i, ar.get(i)]);
        i++;
        return result;
    };
});

const pairsFunction = new LuaBuiltinFunction((t: LuaTable) => {
    const keys = t.keys();
    let i = 0;
    return () => {
        if (i >= keys.length) {
            return;
        }
        const key = keys[i];
        i++;
        return new LuaMultiRes([key, t.get(key)]);
    };
});

const unpackFunction = new LuaBuiltinFunction((t: LuaTable) => {
    const values: LuaValue[] = [];
    for (let i = 1; i <= t.length; i++) {
        values.push(t.get(i));
    }
    return new LuaMultiRes(values);
});

const typeFunction = new LuaBuiltinFunction((value: LuaValue): string => {
    return luaTypeOf(value);
});

const tostringFunction = new LuaBuiltinFunction((value: any) => {
    return luaToString(value);
});

const tonumberFunction = new LuaBuiltinFunction((value: LuaValue) => {
    return Number(value);
});

const errorFunction = new LuaBuiltinFunction((message: string) => {
    throw new Error(message);
});

const pcallFunction = new LuaBuiltinFunction(
    async (fn: ILuaFunction, ...args) => {
        try {
            return new LuaMultiRes([true, await fn.call(...args)]);
        } catch (e: any) {
            return new LuaMultiRes([false, e.message]);
        }
    },
);

const xpcallFunction = new LuaBuiltinFunction(
    async (fn: ILuaFunction, errorHandler: ILuaFunction, ...args) => {
        try {
            return new LuaMultiRes([true, await fn.call(...args)]);
        } catch (e: any) {
            return new LuaMultiRes([false, await errorHandler.call(e.message)]);
        }
    },
);

const setmetatableFunction = new LuaBuiltinFunction(
    (table: LuaTable, metatable: LuaTable) => {
        table.metatable = metatable;
        return table;
    },
);

const rawsetFunction = new LuaBuiltinFunction(
    (table: LuaTable, key: LuaValue, value: LuaValue) => {
        table.rawSet(key, value);
        return table;
    },
);

const getmetatableFunction = new LuaBuiltinFunction((table: LuaTable) => {
    return table.metatable;
});

const stringFunctions = new LuaTable({
    byte: new LuaBuiltinFunction((s: string, i?: number, j?: number) => {
        i = i ?? 1;
        j = j ?? i;
        const result = [];
        for (let k = i; k <= j; k++) {
            result.push(s.charCodeAt(k - 1));
        }
        return new LuaMultiRes(result);
    }),
    char: new LuaBuiltinFunction((...args: number[]) => {
        return String.fromCharCode(...args);
    }),
    find: new LuaBuiltinFunction(
        (s: string, pattern: string, init?: number, plain?: boolean) => {
            init = init ?? 1;
            plain = plain ?? false;
            const result = s.slice(init - 1).match(pattern);
            if (!result) {
                return new LuaMultiRes([]);
            }
            return new LuaMultiRes([
                result.index! + 1,
                result.index! + result[0].length,
            ]);
        },
    ),
    format: new LuaBuiltinFunction((format: string, ...args: any[]) => {
        return format.replace(/%./g, (match) => {
            switch (match) {
                case "%s":
                    return luaToString(args.shift());
                case "%d":
                    return String(args.shift());
                default:
                    return match;
            }
        });
    }),
    gmatch: new LuaBuiltinFunction((s: string, pattern: string) => {
        const regex = new RegExp(pattern, "g");
        return () => {
            const result = regex.exec(s);
            if (!result) {
                return;
            }
            return new LuaMultiRes(result.slice(1));
        };
    }),
    gsub: new LuaBuiltinFunction(
        (s: string, pattern: string, repl: string, n?: number) => {
            n = n ?? Infinity;
            const regex = new RegExp(pattern, "g");
            let result = s;
            let match: RegExpExecArray | null;
            for (let i = 0; i < n; i++) {
                match = regex.exec(result);
                if (!match) {
                    break;
                }
                result = result.replace(match[0], repl);
            }
            return result;
        },
    ),
    len: new LuaBuiltinFunction((s: string) => {
        return s.length;
    }),
    lower: new LuaBuiltinFunction((s: string) => {
        return luaToString(s.toLowerCase());
    }),
    upper: new LuaBuiltinFunction((s: string) => {
        return luaToString(s.toUpperCase());
    }),
    match: new LuaBuiltinFunction(
        (s: string, pattern: string, init?: number) => {
            init = init ?? 1;
            const result = s.slice(init - 1).match(pattern);
            if (!result) {
                return new LuaMultiRes([]);
            }
            return new LuaMultiRes(result.slice(1));
        },
    ),
    rep: new LuaBuiltinFunction((s: string, n: number, sep?: string) => {
        sep = sep ?? "";
        return s.repeat(n) + sep;
    }),
    reverse: new LuaBuiltinFunction((s: string) => {
        return s.split("").reverse().join("");
    }),
    sub: new LuaBuiltinFunction((s: string, i: number, j?: number) => {
        j = j ?? s.length;
        return s.slice(i - 1, j);
    }),
});

const tableFunctions = new LuaTable({
    concat: new LuaBuiltinFunction(
        (tbl: LuaTable, sep?: string, i?: number, j?: number) => {
            sep = sep ?? "";
            i = i ?? 1;
            j = j ?? tbl.length;
            const result = [];
            for (let k = i; k <= j; k++) {
                result.push(tbl.get(k));
            }
            return result.join(sep);
        },
    ),
    insert: new LuaBuiltinFunction(
        (tbl: LuaTable, posOrValue: number | any, value?: any) => {
            if (value === undefined) {
                value = posOrValue;
                posOrValue = tbl.length + 1;
            }
            tbl.insert(posOrValue, value);
        },
    ),
    remove: new LuaBuiltinFunction((tbl: LuaTable, pos?: number) => {
        pos = pos ?? tbl.length;
        tbl.remove(pos);
    }),
    sort: new LuaBuiltinFunction((tbl: LuaTable, comp?: ILuaFunction) => {
        return tbl.sort(comp);
    }),
});

export function luaBuildStandardEnv() {
    const env = new LuaEnv();
    env.set("print", printFunction);
    env.set("assert", assertFunction);
    env.set("pairs", pairsFunction);
    env.set("ipairs", ipairsFunction);
    env.set("type", typeFunction);
    env.set("tostring", tostringFunction);
    env.set("tonumber", tonumberFunction);
    env.set("error", errorFunction);
    env.set("pcall", pcallFunction);
    env.set("xpcall", xpcallFunction);
    env.set("unpack", unpackFunction);
    env.set("setmetatable", setmetatableFunction);
    env.set("getmetatable", getmetatableFunction);
    env.set("rawset", rawsetFunction);
    env.set("string", stringFunctions);
    env.set("table", tableFunctions);
    return env;
}
