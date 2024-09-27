import type {
    LuaExpression,
    LuaLValue,
    LuaStatement,
} from "$common/space_lua/ast.ts";
import { evalPromiseValues } from "$common/space_lua/util.ts";
import {
    type ILuaFunction,
    type ILuaGettable,
    type ILuaSettable,
    LuaBreak,
    LuaEnv,
    LuaFunction,
    luaGet,
    luaLen,
    type LuaLValueContainer,
    LuaReturn,
    LuaTable,
    luaTruthy,
    type LuaValue,
    singleResult,
} from "./runtime.ts";

export function evalExpression(
    e: LuaExpression,
    env: LuaEnv,
): Promise<LuaValue> | LuaValue {
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
                                table.set(
                                    field.key,
                                    singleResult(value),
                                );
                            }));
                        } else {
                            table.set(field.key, singleResult(value));
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
                                    table.set(
                                        singleResult(key),
                                        singleResult(value),
                                    );
                                }),
                            );
                        } else {
                            table.set(
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
                                table.set(
                                    table.length + 1,
                                    singleResult(value),
                                );
                            }));
                        } else {
                            // +1 because Lua tables are 1-indexed
                            table.set(
                                table.length + 1,
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
): Promise<LuaValue> | LuaValue {
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

export async function evalStatement(
    s: LuaStatement,
    env: LuaEnv,
): Promise<void> {
    switch (s.type) {
        case "Assignment": {
            const values = await evalPromiseValues(
                s.expressions.map((value) => evalExpression(value, env)),
            );
            const lvalues = await evalPromiseValues(s.variables
                .map((lval) => evalLValue(lval, env)));

            for (let i = 0; i < lvalues.length; i++) {
                lvalues[i].env.set(lvalues[i].key, values[i]);
            }

            break;
        }
        case "Local": {
            for (let i = 0; i < s.names.length; i++) {
                if (!s.expressions || s.expressions[i] === undefined) {
                    env.setLocal(s.names[i].name, null);
                } else {
                    const value = await evalExpression(s.expressions[i], env);
                    env.setLocal(s.names[i].name, value);
                }
            }
            break;
        }
        case "Semicolon":
            break;
        case "Label":
        case "Goto":
            throw new Error("Labels and gotos are not supported yet");
        case "Block": {
            const newEnv = new LuaEnv(env);
            for (const statement of s.statements) {
                await evalStatement(statement, newEnv);
            }
            break;
        }
        case "If": {
            for (const cond of s.conditions) {
                if (luaTruthy(await evalExpression(cond.condition, env))) {
                    return evalStatement(cond.block, env);
                }
            }
            if (s.elseBlock) {
                return evalStatement(s.elseBlock, env);
            }
            break;
        }
        case "While": {
            while (luaTruthy(await evalExpression(s.condition, env))) {
                try {
                    await evalStatement(s.block, env);
                } catch (e: any) {
                    if (e instanceof LuaBreak) {
                        break;
                    } else {
                        throw e;
                    }
                }
            }
            break;
        }
        case "Repeat": {
            do {
                try {
                    await evalStatement(s.block, env);
                } catch (e: any) {
                    if (e instanceof LuaBreak) {
                        break;
                    } else {
                        throw e;
                    }
                }
            } while (!luaTruthy(await evalExpression(s.condition, env)));
            break;
        }
        case "Break":
            throw new LuaBreak();
        case "FunctionCallStatement": {
            return evalExpression(s.call, env);
        }
        case "Function": {
            let body = s.body;
            let propNames = s.name.propNames;
            if (s.name.colonName) {
                // function hello:there() -> function hello.there(self) transformation
                body = {
                    ...s.body,
                    parameters: ["self", ...s.body.parameters],
                };
                propNames = [...s.name.propNames, s.name.colonName];
            }
            let settable: ILuaSettable & ILuaGettable = env;
            for (let i = 0; i < propNames.length - 1; i++) {
                settable = settable.get(propNames[i]);
                if (!settable) {
                    throw new Error(
                        `Cannot find property ${propNames[i]}`,
                    );
                }
            }
            settable.set(
                propNames[propNames.length - 1],
                new LuaFunction(body, env),
            );
            break;
        }
        case "Return": {
            throw new LuaReturn(
                await evalPromiseValues(
                    s.expressions.map((value) => evalExpression(value, env)),
                ),
            );
        }
        default:
            throw new Error(`Unknown statement type ${s.type}`);
    }
}

function evalLValue(
    lval: LuaLValue,
    env: LuaEnv,
): LuaLValueContainer | Promise<LuaLValueContainer> {
    switch (lval.type) {
        case "Variable":
            return { env, key: lval.name };
        case "TableAccess": {
            const objValue = evalExpression(
                lval.object,
                env,
            );
            const keyValue = evalExpression(lval.key, env);
            if (
                objValue instanceof Promise ||
                keyValue instanceof Promise
            ) {
                return Promise.all([
                    objValue instanceof Promise
                        ? objValue
                        : Promise.resolve(objValue),
                    keyValue instanceof Promise
                        ? keyValue
                        : Promise.resolve(keyValue),
                ]).then(([objValue, keyValue]) => ({
                    env: singleResult(objValue),
                    key: singleResult(keyValue),
                }));
            } else {
                return {
                    env: singleResult(objValue),
                    key: singleResult(keyValue),
                };
            }
        }
        case "PropertyAccess": {
            const objValue = evalExpression(
                lval.object,
                env,
            );
            if (objValue instanceof Promise) {
                return objValue.then((objValue) => {
                    if (!objValue.set) {
                        throw new Error(
                            `Not a settable object: ${objValue}`,
                        );
                    }
                    return {
                        env: objValue,
                        key: lval.property,
                    };
                });
            } else {
                if (!objValue.set) {
                    throw new Error(
                        `Not a settable object: ${objValue}`,
                    );
                }
                return {
                    env: objValue,
                    key: lval.property,
                };
            }
        }
    }
}
