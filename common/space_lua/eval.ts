import type {
  ASTCtx,
  LuaExpression,
  LuaLValue,
  LuaStatement,
} from "$common/space_lua/ast.ts";
import { evalPromiseValues } from "$common/space_lua/util.ts";
import {
  luaCall,
  luaEquals,
  luaIndexValue,
  luaSet,
  type LuaStackFrame,
} from "$common/space_lua/runtime.ts";
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
  LuaMultiRes,
  LuaReturn,
  LuaRuntimeError,
  LuaTable,
  luaToString,
  luaTruthy,
  type LuaValue,
  singleResult,
} from "./runtime.ts";
import {
  ArrayQueryCollection,
  type LuaCollectionQuery,
} from "$common/space_lua/query_collection.ts";
import { luaValueToJS } from "$common/space_lua/runtime.ts";
import { jsToLuaValue } from "$common/space_lua/runtime.ts";

function handleVarargSync(env: LuaEnv): LuaValue[] | Promise<LuaValue[]> {
  const varargs = env.get("...");
  if (varargs instanceof Promise) {
    return handleVarargAsync(varargs);
  }
  if (varargs instanceof LuaTable) {
    const args = [];
    for (let i = 1; i <= varargs.length; i++) {
      const val = varargs.get(i);
      if (val instanceof Promise) {
        return handleVarargAsync(varargs);
      }
      args.push(val);
    }
    return args;
  }
  return [];
}

async function handleVarargAsync(
  varargs: Promise<LuaValue> | LuaTable,
): Promise<LuaValue[]> {
  const resolvedVarargs = await varargs;
  if (resolvedVarargs instanceof LuaTable) {
    const args = [];
    for (let i = 1; i <= resolvedVarargs.length; i++) {
      args.push(await resolvedVarargs.get(i));
    }
    return args;
  }
  return [];
}

function handleTableFieldSync(
  table: LuaTable,
  field: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): void | Promise<void> {
  switch (field.type) {
    case "PropField": {
      const value = evalExpression(field.value, env, sf);
      if (value instanceof Promise) {
        return value.then((v) => table.set(field.key, singleResult(v), sf));
      }
      table.set(field.key, singleResult(value), sf);
      break;
    }
    case "DynamicField": {
      const key = evalExpression(field.key, env, sf);
      const value = evalExpression(field.value, env, sf);
      if (key instanceof Promise || value instanceof Promise) {
        return Promise.all([
          key instanceof Promise ? key : Promise.resolve(key),
          value instanceof Promise ? value : Promise.resolve(value),
        ]).then(([k, v]) => {
          table.set(singleResult(k), singleResult(v), sf);
        });
      }
      table.set(singleResult(key), singleResult(value), sf);
      break;
    }
    case "ExpressionField": {
      if (field.value.type === "Variable" && field.value.name === "...") {
        const varargs = handleVarargSync(env);
        if (varargs instanceof Promise) {
          return varargs.then((args) => {
            args.forEach((val, i) => table.set(i + 1, val, sf));
          });
        }
        varargs.forEach((val, i) => table.set(i + 1, val, sf));
      } else {
        const value = evalExpression(field.value, env, sf);
        if (value instanceof Promise) {
          return value.then((v) =>
            table.set(table.length + 1, singleResult(v), sf)
          );
        }
        table.set(table.length + 1, singleResult(value), sf);
      }
      break;
    }
  }
}

export function evalExpression(
  e: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue> | LuaValue {
  try {
    switch (e.type) {
      case "String":
        return e.value;
      case "Number":
        return e.value;
      case "Boolean":
        return e.value;
      case "Nil":
        return null;
      case "Binary": {
        if (e.operator === "or") {
          // Special case: eagerly evaluate left before even attempting right
          const left = evalExpression(e.left, env, sf);
          if (left instanceof Promise) {
            return left.then((left) => {
              if (luaTruthy(left)) {
                return left;
              }
              return evalExpression(e.right, env, sf);
            });
          } else if (luaTruthy(left)) {
            return left;
          } else {
            return evalExpression(e.right, env, sf);
          }
        }
        const values = evalPromiseValues([
          evalExpression(e.left, env, sf),
          evalExpression(e.right, env, sf),
        ]);
        if (values instanceof Promise) {
          return values.then(([left, right]) =>
            luaOp(
              e.operator,
              singleResult(left),
              singleResult(right),
              e.ctx,
              sf,
            )
          );
        } else {
          return luaOp(
            e.operator,
            singleResult(values[0]),
            singleResult(values[1]),
            e.ctx,
            sf,
          );
        }
      }
      case "Unary": {
        const value = evalExpression(e.argument, env, sf);
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

      case "Variable":
      case "FunctionCall":
      case "TableAccess":
      case "PropertyAccess":
        return evalPrefixExpression(e, env, sf);
      case "TableConstructor": {
        const table = new LuaTable();

        if (
          e.fields.length === 1 &&
          e.fields[0].type === "ExpressionField" &&
          e.fields[0].value.type === "Variable" &&
          e.fields[0].value.name === "..."
        ) {
          const varargs = handleVarargSync(env);
          if (varargs instanceof Promise) {
            return varargs.then((args) => {
              args.forEach((val, i) => table.set(i + 1, val, sf));
              return table;
            });
          }
          varargs.forEach((val, i) => table.set(i + 1, val, sf));
          return table;
        }

        const promises: Promise<void>[] = [];
        for (const field of e.fields) {
          const result = handleTableFieldSync(table, field, env, sf);
          if (result instanceof Promise) {
            promises.push(result);
          }
        }

        if (promises.length > 0) {
          return Promise.all(promises).then(() => table);
        }
        return table;
      }
      case "FunctionDefinition": {
        return new LuaFunction(e.body, env);
      }
      case "Query": {
        // console.log("Query", e);
        const findFromClause = e.clauses.find((c) => c.type === "From");
        if (!findFromClause) {
          throw new LuaRuntimeError("No from clause found", sf.withCtx(e.ctx));
        }
        const objectVariable = findFromClause.name;
        const objectExpression = findFromClause.expression;
        return Promise.resolve(evalExpression(objectExpression, env, sf)).then(
          async (collection: LuaValue) => {
            if (!collection) {
              throw new LuaRuntimeError(
                "Collection is nil",
                sf.withCtx(e.ctx),
              );
            }
            collection = luaValueToJS(collection);
            // Check if collection is a queryable collection
            if (!collection.query) {
              // If not, try to convert it to JS and see if it's an array
              collection = await luaValueToJS(collection);
              if (!Array.isArray(collection)) {
                throw new LuaRuntimeError(
                  "Collection does not support query",
                  sf.withCtx(e.ctx),
                );
              }
              collection = new ArrayQueryCollection(collection);
            }
            // Build up query object
            const query: LuaCollectionQuery = {
              objectVariable,
            };

            // Map clauses to query parameters
            for (const clause of e.clauses) {
              switch (clause.type) {
                case "Where": {
                  query.where = clause.expression;
                  break;
                }
                case "OrderBy": {
                  query.orderBy = clause.orderBy.map((o) => ({
                    expr: o.expression,
                    desc: o.direction === "desc",
                  }));
                  break;
                }
                case "Select": {
                  query.select = clause.expression;
                  break;
                }
                case "Limit": {
                  const limitVal = await evalExpression(clause.limit, env, sf);
                  query.limit = Number(limitVal);
                  if (clause.offset) {
                    const offsetVal = await evalExpression(
                      clause.offset,
                      env,
                      sf,
                    );
                    query.offset = Number(offsetVal);
                  }
                  break;
                }
              }
            }

            return collection.query(query, env, sf).then(jsToLuaValue);
          },
        );
      }
      default:
        throw new Error(`Unknown expression type ${e.type}`);
    }
  } catch (err: any) {
    // Repackage any non Lua-specific exceptions with some position information
    if (!err.constructor.name.startsWith("Lua")) {
      throw new LuaRuntimeError(err.message, sf.withCtx(e.ctx), err);
    } else {
      throw err;
    }
  }
}

function evalPrefixExpression(
  e: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue> | LuaValue {
  switch (e.type) {
    case "Variable": {
      const value = env.get(e.name);
      if (value === undefined) {
        return null;
      } else {
        return value;
      }
    }
    case "Parenthesized":
      return evalExpression(e.expression, env, sf);
    // <<expr>>[<<expr>>]
    case "TableAccess": {
      const values = evalPromiseValues([
        evalPrefixExpression(e.object, env, sf),
        evalExpression(e.key, env, sf),
      ]);
      if (values instanceof Promise) {
        return values.then(([table, key]) => {
          table = singleResult(table);
          key = singleResult(key);

          return luaGet(table, key, sf.withCtx(e.ctx));
        });
      } else {
        const table = singleResult(values[0]);
        const key = singleResult(values[1]);
        return luaGet(table, singleResult(key), sf.withCtx(e.ctx));
      }
    }
    // <expr>.property
    case "PropertyAccess": {
      const obj = evalPrefixExpression(e.object, env, sf);
      if (obj instanceof Promise) {
        return obj.then((obj) => {
          return luaGet(obj, e.property, sf.withCtx(e.ctx));
        });
      } else {
        return luaGet(obj, e.property, sf.withCtx(e.ctx));
      }
    }
    case "FunctionCall": {
      const prefixValue = evalPrefixExpression(e.prefix, env, sf);
      if (!prefixValue) {
        throw new LuaRuntimeError(
          `Attempting to call nil as a function`,
          sf.withCtx(e.prefix.ctx),
        );
      }

      let selfArgs: LuaValue[] = [];

      const handleFunctionCall = (
        prefixValue: LuaValue,
      ): LuaValue | Promise<LuaValue> => {
        // Special handling for f(...) - propagate varargs
        if (
          e.args.length === 1 && e.args[0].type === "Variable" &&
          e.args[0].name === "..."
        ) {
          // TODO: Clean this up
          const varargs = env.get("...");
          const resolveVarargs = async () => {
            const resolvedVarargs = await Promise.resolve(varargs);
            if (resolvedVarargs instanceof LuaTable) {
              const args = [];
              for (let i = 1; i <= resolvedVarargs.length; i++) {
                const val = await Promise.resolve(resolvedVarargs.get(i));
                args.push(val);
              }
              return args;
            }
            return [];
          };

          if (prefixValue instanceof Promise) {
            return prefixValue.then(async (resolvedPrefix) => {
              const args = await resolveVarargs();
              return luaCall(resolvedPrefix, args, e.ctx, sf.withCtx(e.ctx));
            });
          } else {
            return resolveVarargs().then((args) =>
              luaCall(prefixValue, args, e.ctx, sf.withCtx(e.ctx))
            );
          }
        }

        // Normal argument handling for hello:there(a, b, c) type calls
        if (e.name) {
          selfArgs = [prefixValue];
          prefixValue = luaIndexValue(prefixValue, e.name, sf);
          if (prefixValue === null) {
            throw new LuaRuntimeError(
              `Attempting to index a non-table: ${prefixValue}`,
              sf.withCtx(e.prefix.ctx),
            );
          }
          if (prefixValue instanceof Promise) {
            return prefixValue.then(handleFunctionCall);
          }
        }
        if (!prefixValue.call) {
          throw new LuaRuntimeError(
            `Attempting to call ${prefixValue} as a function`,
            sf.withCtx(e.prefix.ctx),
          );
        }
        const args = evalPromiseValues(
          e.args.map((arg) => evalExpression(arg, env, sf)),
        );
        if (args instanceof Promise) {
          return args.then((args) =>
            luaCall(prefixValue, [...selfArgs, ...args], e.ctx, sf)
          );
        } else {
          return luaCall(prefixValue, [...selfArgs, ...args], e.ctx, sf);
        }
      };
      if (prefixValue instanceof Promise) {
        return prefixValue.then(handleFunctionCall);
      } else {
        return handleFunctionCall(prefixValue);
      }
    }
    default:
      throw new Error(`Unknown prefix expression type ${e.type}`);
  }
}

// Helper functions to reduce duplication
function evalMetamethod(
  left: any,
  right: any,
  metaMethod: string,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaValue | undefined {
  const leftMetatable = getMetatable(left, sf);
  const rightMetatable = getMetatable(right, sf);
  if (leftMetatable?.has(metaMethod)) {
    const fn = leftMetatable.get(metaMethod);
    return luaCall(fn, [left, right], ctx, sf);
  } else if (rightMetatable?.has(metaMethod)) {
    const fn = rightMetatable.get(metaMethod);
    return luaCall(fn, [left, right], ctx, sf);
  }
}

export function getMetatable(
  value: LuaValue,
  sf?: LuaStackFrame,
): LuaValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    // Add a metatable to the string value on the fly
    if (!sf) {
      console.warn(
        "metatable lookup with string value but no stack frame, returning nil",
      );
      return null;
    }
    if (!sf.threadLocal.get("_GLOBAL")) {
      console.warn(
        "metatable lookup with string value but no _GLOBAL, returning nil",
      );
      return null;
    }
    const stringMetatable = new LuaTable();
    stringMetatable.set("__index", sf.threadLocal.get("_GLOBAL").get("string"));
    return stringMetatable;
  }
  if (value.metatable) {
    return value.metatable;
  } else {
    return null;
  }
}

// Simplified operator definitions
const operatorsMetaMethods: Record<string, {
  metaMethod?: string;
  nativeImplementation: (
    a: LuaValue,
    b: LuaValue,
    ctx: ASTCtx,
    sf: LuaStackFrame,
  ) => LuaValue;
}> = {
  "+": { metaMethod: "__add", nativeImplementation: (a, b) => a + b },
  "-": { metaMethod: "__sub", nativeImplementation: (a, b) => a - b },
  "*": { metaMethod: "__mul", nativeImplementation: (a, b) => a * b },
  "/": { metaMethod: "__div", nativeImplementation: (a, b) => a / b },
  "//": {
    metaMethod: "__idiv",
    nativeImplementation: (a, b) => Math.floor(a / b),
  },
  "%": { metaMethod: "__mod", nativeImplementation: (a, b) => a % b },
  "^": { metaMethod: "__pow", nativeImplementation: (a, b) => a ** b },
  "..": {
    metaMethod: "__concat",
    nativeImplementation: (a, b) => {
      const aString = luaToString(a);
      const bString = luaToString(b);
      if (aString instanceof Promise || bString instanceof Promise) {
        return Promise.all([aString, bString]).then(([a, b]) => a + b);
      } else {
        return aString + bString;
      }
    },
  },
  "==": {
    metaMethod: "__eq",
    nativeImplementation: (a, b) => luaEquals(a, b),
  },
  "~=": {
    metaMethod: "__ne",
    nativeImplementation: (a, b) => !luaEquals(a, b),
  },
  "!=": {
    metaMethod: "__ne",
    nativeImplementation: (a, b) => !luaEquals(a, b),
  },
  "<": { metaMethod: "__lt", nativeImplementation: (a, b) => a < b },
  "<=": { metaMethod: "__le", nativeImplementation: (a, b) => a <= b },
  ">": { nativeImplementation: (a, b, ctx, sf) => !luaOp("<=", a, b, ctx, sf) },
  ">=": { nativeImplementation: (a, b, ctx, sf) => !luaOp("<", a, b, ctx, sf) },
  "and": {
    metaMethod: "__and",
    nativeImplementation: (a, b) => a && b,
  },
  "or": { metaMethod: "__or", nativeImplementation: (a, b) => a || b },
};

function luaOp(
  op: string,
  left: any,
  right: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  const handler = operatorsMetaMethods[op];
  if (!handler) {
    throw new LuaRuntimeError(`Unknown operator ${op}`, sf.withCtx(ctx));
  }

  if (handler.metaMethod) {
    const metaResult = evalMetamethod(left, right, handler.metaMethod, ctx, sf);
    if (metaResult !== undefined) {
      return metaResult;
    }
  }

  return handler.nativeImplementation(left, right, ctx, sf);
}

async function evalExpressions(
  es: LuaExpression[],
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue[]> {
  return new LuaMultiRes(
    await Promise.all(es.map((e) => evalExpression(e, env, sf))),
  ).flatten().values;
}

export async function evalStatement(
  s: LuaStatement,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<void> {
  switch (s.type) {
    case "Assignment": {
      const values = await evalExpressions(s.expressions, env, sf);
      const lvalues = await evalPromiseValues(s.variables
        .map((lval) => evalLValue(lval, env, sf)));

      for (let i = 0; i < lvalues.length; i++) {
        await luaSet(
          lvalues[i].env,
          lvalues[i].key,
          values[i],
          sf.withCtx(s.ctx),
        );
      }

      break;
    }
    case "Local": {
      if (s.expressions) {
        const values = await evalExpressions(s.expressions, env, sf);
        for (let i = 0; i < s.names.length; i++) {
          env.setLocal(s.names[i].name, values[i]);
        }
      } else {
        for (let i = 0; i < s.names.length; i++) {
          env.setLocal(s.names[i].name, null);
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
        await evalStatement(statement, newEnv, sf);
      }
      break;
    }
    case "If": {
      for (const cond of s.conditions) {
        if (luaTruthy(await evalExpression(cond.condition, env, sf))) {
          return evalStatement(cond.block, env, sf);
        }
      }
      if (s.elseBlock) {
        return evalStatement(s.elseBlock, env, sf);
      }
      break;
    }
    case "While": {
      while (luaTruthy(await evalExpression(s.condition, env, sf))) {
        try {
          await evalStatement(s.block, env, sf);
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
          await evalStatement(s.block, env, sf);
        } catch (e: any) {
          if (e instanceof LuaBreak) {
            break;
          } else {
            throw e;
          }
        }
      } while (!luaTruthy(await evalExpression(s.condition, env, sf)));
      break;
    }
    case "Break":
      throw new LuaBreak();
    case "FunctionCallStatement": {
      return evalExpression(s.call, env, sf);
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
          throw new LuaRuntimeError(
            `Cannot find property ${propNames[i]}`,
            sf.withCtx(s.name.ctx),
          );
        }
      }
      settable.set(
        propNames[propNames.length - 1],
        new LuaFunction(body, env),
      );
      break;
    }
    case "LocalFunction": {
      env.setLocal(
        s.name,
        new LuaFunction(s.body, env),
      );
      break;
    }
    case "Return": {
      // A return statement for now is implemented by throwing the value as an exception, this should
      // be optimized for the common case later
      throw new LuaReturn(
        await evalPromiseValues(
          s.expressions.map((value) => evalExpression(value, env, sf)),
        ),
      );
    }
    case "For": {
      const start = await evalExpression(s.start, env, sf);
      const end = await evalExpression(s.end, env, sf);
      const step = s.step ? await evalExpression(s.step, env, sf) : 1;
      for (
        let i = start;
        step > 0 ? i <= end : i >= end;
        i += step
      ) {
        const localEnv = new LuaEnv(env);
        localEnv.setLocal(s.name, i);
        try {
          await evalStatement(s.block, localEnv, sf);
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
    case "ForIn": {
      const iteratorMultiRes = new LuaMultiRes(
        await evalPromiseValues(
          s.expressions.map((e) => evalExpression(e, env, sf)),
        ),
      ).flatten();
      let iteratorValue: ILuaFunction | any = iteratorMultiRes.values[0];
      // Handle the case where the iterator is a table and we need to call the each function
      if (Array.isArray(iteratorValue) || iteratorValue instanceof LuaTable) {
        iteratorValue = env.get("each").call(sf, iteratorValue);
      }

      if (!iteratorValue?.call) {
        console.error("Cannot iterate over", iteratorMultiRes.values[0]);
        throw new LuaRuntimeError(
          `Cannot iterate over ${iteratorMultiRes.values[0]}`,
          sf.withCtx(s.ctx),
        );
      }

      const state: LuaValue = iteratorMultiRes.values[1] || null;
      const control: LuaValue = iteratorMultiRes.values[2] || null;

      while (true) {
        const iterResult = new LuaMultiRes(
          await luaCall(iteratorValue, [state, control], s.ctx, sf),
        ).flatten();
        if (
          iterResult.values[0] === null || iterResult.values[0] === undefined
        ) {
          break;
        }
        const localEnv = new LuaEnv(env);
        for (let i = 0; i < s.names.length; i++) {
          localEnv.setLocal(s.names[i], iterResult.values[i]);
        }
        try {
          await evalStatement(s.block, localEnv, sf);
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
  }
}

function evalLValue(
  lval: LuaLValue,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaLValueContainer | Promise<LuaLValueContainer> {
  switch (lval.type) {
    case "Variable":
      return { env, key: lval.name };
    case "TableAccess": {
      const objValue = evalExpression(
        lval.object,
        env,
        sf,
      );
      const keyValue = evalExpression(lval.key, env, sf);
      if (
        objValue instanceof Promise ||
        keyValue instanceof Promise
      ) {
        return Promise.all([
          objValue instanceof Promise ? objValue : Promise.resolve(objValue),
          keyValue instanceof Promise ? keyValue : Promise.resolve(keyValue),
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
        sf,
      );
      if (objValue instanceof Promise) {
        return objValue.then((objValue) => {
          return {
            env: objValue,
            key: lval.property,
          };
        });
      } else {
        return {
          env: objValue,
          key: lval.property,
        };
      }
    }
  }
}
