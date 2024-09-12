import type {
    LuaExpression,
    LuaFunctionBody,
} from "$common/space_lua/parse.ts";
import { evalPromiseValues } from "$common/space_lua/util.ts";

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

interface ILuaFunction {
    call(...args: any[]): Promise<LuaMultiRes> | LuaMultiRes;
}

export class LuaFunction implements ILuaFunction {
    constructor(readonly body: LuaFunctionBody) {
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
}

export function luaSet(obj: any, key: any, value: any) {
    if (obj instanceof LuaTable) {
        obj.set(key, value);
    } else {
        obj[key] = value;
    }
}

function luaGet(obj: any, key: any): any {
    if (obj instanceof LuaTable) {
        return obj.get(key);
    } else {
        return obj[key];
    }
}

export function evalExpression(
    e: LuaExpression,
    env: LuaEnv,
): Promise<any> | any {
    switch (e.type) {
        case "String":
            // TODO: Deal with escape sequences
            return e.value;
        case "Number":
            return e.value;
        case "Boolean":
            return e.value;
        case "Nil":
            return null;
        case "Binary": {
            const values = evalPromiseValues([
                evalExpression(e.left, env),
                evalExpression(e.right, env),
            ]);
            if (values instanceof Promise) {
                return values.then(([left, right]) =>
                    luaOp(e.operator, singleResult(left), singleResult(right))
                );
            } else {
                return luaOp(
                    e.operator,
                    singleResult(values[0]),
                    singleResult(values[1]),
                );
            }
        }
        case "TableAccess": {
            const values = evalPromiseValues([
                evalPrefixExpression(e.object, env),
                evalExpression(e.key, env),
            ]);
            if (values instanceof Promise) {
                return values.then(([table, key]) =>
                    luaGet(singleResult(table), singleResult(key))
                );
            } else {
                return luaGet(singleResult(values[0]), singleResult(values[1]));
            }
        }
        case "Variable":
        case "FunctionCall":
            return evalPrefixExpression(e, env);
        default:
            throw new Error(`Unknown expression type ${e.type}`);
    }
}

function evalPrefixExpression(
    e: LuaExpression,
    env: LuaEnv,
): Promise<any> | any {
    switch (e.type) {
        case "Variable": {
            const value = env.get(e.name);
            if (value === undefined) {
                throw new Error(`Undefined variable ${e.name}`);
            } else {
                return value;
            }
        }
        case "Parenthesized":
            return evalExpression(e.expression, env);
        case "FunctionCall": {
            const fn = evalPrefixExpression(e.prefix, env);
            if (fn instanceof Promise) {
                return fn.then((fn: ILuaFunction) => {
                    if (!fn.call) {
                        throw new Error(`Not a function: ${fn}`);
                    }
                    const args = evalPromiseValues(
                        e.args.map((arg) => evalExpression(arg, env)),
                    );
                    if (args instanceof Promise) {
                        return args.then((args) => fn.call(...args));
                    } else {
                        return fn.call(...args);
                    }
                });
            } else {
                if (!fn.call) {
                    throw new Error(`Not a function: ${fn}`);
                }
                const args = evalPromiseValues(
                    e.args.map((arg) => evalExpression(arg, env)),
                );
                if (args instanceof Promise) {
                    return args.then((args) => fn.call(...args));
                } else {
                    return fn.call(...args);
                }
            }
        }
        default:
            throw new Error(`Unknown prefix expression type ${e.type}`);
    }
}

function luaOp(op: string, left: any, right: any): any {
    switch (op) {
        case "+":
            return left + right;
        case "-":
            return left - right;
        case "*":
            return left * right;
        case "/":
            return left / right;
        case "%":
            return left % right;
        case "^":
            return left ** right;
        case "..":
            return left + right;
        case "==":
            return left === right;
        case "~=":
            return left !== right;
        case "<":
            return left < right;
        case "<=":
            return left <= right;
        case ">":
            return left > right;
        case ">=":
            return left >= right;
        case "and":
            return left && right;
        case "or":
            return left || right;
        default:
            throw new Error(`Unknown operator ${op}`);
    }
}
