import type { LuaExpression } from "$common/space_lua/ast.ts";
import { evalPromiseValues } from "$common/space_lua/util.ts";
import {
    type ILuaFunction,
    type LuaEnv,
    luaGet,
    luaLen,
    LuaTable,
    singleResult,
} from "./runtime.ts";

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
        case "Unary": {
            const value = evalExpression(e.argument, env);
            if (value instanceof Promise) {
                return value.then((value) => {
                    switch (e.operator) {
                        case "-":
                            return -singleResult(value);
                        case "+":
                            return +singleResult(value);
                        case "not":
                            return !singleResult(value);
                        case "#":
                            return luaLen(singleResult(value));
                        default:
                            throw new Error(
                                `Unknown unary operator ${e.operator}`,
                            );
                    }
                });
            } else {
                switch (e.operator) {
                    case "-":
                        return -singleResult(value);
                    case "+":
                        return +singleResult(value);
                    case "not":
                        return !singleResult(value);
                    case "#":
                        return luaLen(singleResult(value));
                    default:
                        throw new Error(
                            `Unknown unary operator ${e.operator}`,
                        );
                }
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
        case "TableConstructor": {
            const table = new LuaTable();
            const promises: Promise<void>[] = [];
            for (const field of e.fields) {
                switch (field.type) {
                    case "PropField": {
                        const value = evalExpression(field.value, env);
                        if (value instanceof Promise) {
                            promises.push(value.then((value) => {
                                table.entries.set(
                                    field.key,
                                    singleResult(value),
                                );
                            }));
                        } else {
                            table.entries.set(field.key, singleResult(value));
                        }
                        break;
                    }
                    case "DynamicField": {
                        const key = evalExpression(field.key, env);
                        const value = evalExpression(field.value, env);
                        if (
                            key instanceof Promise || value instanceof Promise
                        ) {
                            promises.push(
                                Promise.all([
                                    key instanceof Promise
                                        ? key
                                        : Promise.resolve(key),
                                    value instanceof Promise
                                        ? value
                                        : Promise.resolve(value),
                                ]).then(([key, value]) => {
                                    table.entries.set(
                                        singleResult(key),
                                        singleResult(value),
                                    );
                                }),
                            );
                        } else {
                            table.entries.set(
                                singleResult(key),
                                singleResult(value),
                            );
                        }
                        break;
                    }
                    case "ExpressionField": {
                        const value = evalExpression(field.value, env);
                        if (value instanceof Promise) {
                            promises.push(value.then((value) => {
                                // +1 because Lua tables are 1-indexed
                                table.entries.set(
                                    table.entries.size + 1,
                                    singleResult(value),
                                );
                            }));
                        } else {
                            // +1 because Lua tables are 1-indexed
                            table.entries.set(
                                table.entries.size + 1,
                                singleResult(value),
                            );
                        }
                        break;
                    }
                }
            }
            if (promises.length > 0) {
                return Promise.all(promises).then(() => table);
            } else {
                return table;
            }
        }
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
        case "//":
            return Math.floor(left / right);
        case "%":
            return left % right;
        case "^":
            return left ** right;
        case "..":
            return left + right;
        case "==":
            return left === right;
        case "~=":
        case "!=":
        case "/=":
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
