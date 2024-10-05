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
  LuaMultiRes,
  LuaReturn,
  LuaRuntimeError,
  LuaTable,
  luaToString,
  luaTruthy,
  type LuaValue,
  singleResult,
} from "./runtime.ts";

export function evalExpression(
  e: LuaExpression,
  env: LuaEnv,
): Promise<LuaValue> | LuaValue {
  try {
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
      case "PropertyAccess": {
        const obj = evalPrefixExpression(e.object, env);
        if (obj instanceof Promise) {
          return obj.then((obj) => {
            if (!obj.get) {
              throw new Error(
                `Not a gettable object: ${obj}`,
              );
            }
            return obj.get(e.property);
          });
        } else {
          if (!obj.get) {
            throw new Error(
              `Not a gettable object: ${obj}`,
            );
          }
          return obj.get(e.property);
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
                    key instanceof Promise ? key : Promise.resolve(key),
                    value instanceof Promise ? value : Promise.resolve(value),
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
      case "FunctionDefinition": {
        return new LuaFunction(e.body, env);
      }
      default:
        throw new Error(`Unknown expression type ${e.type}`);
    }
  } catch (err: any) {
    // Repackage any non Lua-specific exceptions with some position information
    if (!err.constructor.name.startsWith("Lua")) {
      throw new LuaRuntimeError(err.message, e.ctx, err);
    } else {
      throw err;
    }
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
        return null;
      } else {
        return value;
      }
    }
    case "Parenthesized":
      return evalExpression(e.expression, env);
    case "PropertyAccess": {
      const obj = evalPrefixExpression(e.object, env);
      if (obj instanceof Promise) {
        return obj.then((obj) => {
          if (!obj?.get) {
            throw new Error(
              `Attempting to index non-indexable object: ${obj}`,
            );
          }
          return obj.get(e.property);
        });
      } else {
        if (!obj?.get) {
          throw new Error(
            `Attempting to index non-indexable object: ${obj}`,
          );
        }
        return obj.get(e.property);
      }
    }
    case "FunctionCall": {
      let prefixValue = evalPrefixExpression(e.prefix, env);
      if (!prefixValue) {
        throw new LuaRuntimeError(
          `Attempting to call nil as a function`,
          e.prefix.ctx,
        );
      }
      if (prefixValue instanceof Promise) {
        return prefixValue.then((prefixValue) => {
          if (!prefixValue) {
            throw new LuaRuntimeError(
              `Attempting to call a nil value`,
              e.prefix.ctx,
            );
          }
          let selfArgs: LuaValue[] = [];
          // Handling a:b() syntax (b is kept in .name)
          if (e.name && !prefixValue.get) {
            throw new LuaRuntimeError(
              `Attempting to index a non-table: ${prefixValue}`,
              e.prefix.ctx,
            );
          } else if (e.name) {
            // Two things need to happen: the actual function be called needs to be looked up in the table, and the table itself needs to be passed as the first argument
            selfArgs = [prefixValue];
            prefixValue = prefixValue.get(e.name);
          }
          if (!prefixValue.call) {
            throw new LuaRuntimeError(
              `Attempting to call ${prefixValue} as a function`,
              prefixValue.ctx,
            );
          }
          const args = evalPromiseValues(
            e.args.map((arg) => evalExpression(arg, env)),
          );
          if (args instanceof Promise) {
            return args.then((args) => prefixValue.call(...selfArgs, ...args));
          } else {
            return prefixValue.call(...selfArgs, ...args);
          }
        });
      } else {
        let selfArgs: LuaValue[] = [];
        // Handling a:b() syntax (b is kept in .name)
        if (e.name && !prefixValue.get) {
          throw new LuaRuntimeError(
            `Attempting to index a non-table: ${prefixValue}`,
            e.prefix.ctx,
          );
        } else if (e.name) {
          // Two things need to happen: the actual function be called needs to be looked up in the table, and the table itself needs to be passed as the first argument
          selfArgs = [prefixValue];
          prefixValue = prefixValue.get(e.name);
        }
        if (!prefixValue.call) {
          throw new LuaRuntimeError(
            `Attempting to call ${prefixValue} as a function`,
            e.prefix.ctx,
          );
        }
        const args = evalPromiseValues(
          e.args.map((arg) => evalExpression(arg, env)),
        );
        if (args instanceof Promise) {
          return args.then((args) => prefixValue.call(...selfArgs, ...args));
        } else {
          return prefixValue.call(...selfArgs, ...args);
        }
      }
    }
    default:
      throw new Error(`Unknown prefix expression type ${e.type}`);
  }
}

// Mapping table of operators meta-methods to their corresponding operator

type LuaMetaMethod = Record<string, {
  metaMethod?: string;
  nativeImplementation: (a: LuaValue, b: LuaValue) => LuaValue;
}>;

const operatorsMetaMethods: LuaMetaMethod = {
  "+": {
    metaMethod: "__add",
    nativeImplementation: (a, b) => a + b,
  },
  "-": {
    metaMethod: "__sub",
    nativeImplementation: (a, b) => a - b,
  },
  "*": {
    metaMethod: "__mul",
    nativeImplementation: (a, b) => a * b,
  },
  "/": {
    metaMethod: "__div",
    nativeImplementation: (a, b) => a / b,
  },
  "//": {
    metaMethod: "__idiv",
    nativeImplementation: (a, b) => Math.floor(a / b),
  },
  "%": {
    metaMethod: "__mod",
    nativeImplementation: (a, b) => a % b,
  },
  "^": {
    metaMethod: "__pow",
    nativeImplementation: (a, b) => a ** b,
  },
  "..": {
    metaMethod: "__concat",
    nativeImplementation: (a, b) => luaToString(a) + luaToString(b),
  },
  "==": {
    metaMethod: "__eq",
    nativeImplementation: (a, b) => a === b,
  },
  "~=": {
    metaMethod: "__ne",
    nativeImplementation: (a, b) => a !== b,
  },
  "!=": {
    metaMethod: "__ne",
    nativeImplementation: (a, b) => a !== b,
  },
  "<": {
    metaMethod: "__lt",
    nativeImplementation: (a, b) => a < b,
  },
  "<=": {
    metaMethod: "__le",
    nativeImplementation: (a, b) => a <= b,
  },
  ">": {
    nativeImplementation: (a, b) => !luaOp("<=", a, b),
  },
  ">=": {
    nativeImplementation: (a, b) => !luaOp("<", a, b),
  },
  and: {
    metaMethod: "__and",
    nativeImplementation: (a, b) => a && b,
  },
  or: {
    metaMethod: "__or",
    nativeImplementation: (a, b) => a || b,
  },
};

function luaOp(op: string, left: any, right: any): any {
  const operatorHandler = operatorsMetaMethods[op];
  if (!operatorHandler) {
    throw new Error(`Unknown operator ${op}`);
  }
  if (operatorHandler.metaMethod) {
    if (left?.metatable?.has(operatorHandler.metaMethod)) {
      const fn = left.metatable.get(operatorHandler.metaMethod);
      if (!fn.call) {
        throw new Error(
          `Meta method ${operatorHandler.metaMethod} is not callable`,
        );
      } else {
        return fn.call(left, right);
      }
    } else if (right?.metatable?.has(operatorHandler.metaMethod)) {
      const fn = right.metatable.get(operatorHandler.metaMethod);
      if (!fn.call) {
        throw new Error(
          `Meta method ${operatorHandler.metaMethod} is not callable`,
        );
      } else {
        return fn.call(right, left);
      }
    }
  }
  return operatorHandler.nativeImplementation(left, right);
}

async function evalExpressions(
  es: LuaExpression[],
  env: LuaEnv,
): Promise<LuaValue[]> {
  return new LuaMultiRes(
    await Promise.all(es.map((e) => evalExpression(e, env))),
  ).flatten().values;
}

export async function evalStatement(
  s: LuaStatement,
  env: LuaEnv,
): Promise<void> {
  switch (s.type) {
    case "Assignment": {
      const values = await evalExpressions(s.expressions, env);
      const lvalues = await evalPromiseValues(s.variables
        .map((lval) => evalLValue(lval, env)));

      for (let i = 0; i < lvalues.length; i++) {
        lvalues[i].env.set(lvalues[i].key, values[i]);
      }

      break;
    }
    case "Local": {
      if (s.expressions) {
        const values = await evalExpressions(s.expressions, env);
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
          s.expressions.map((value) => evalExpression(value, env)),
        ),
      );
    }
    case "For": {
      const start = await evalExpression(s.start, env);
      const end = await evalExpression(s.end, env);
      const step = s.step ? await evalExpression(s.step, env) : 1;
      const localEnv = new LuaEnv(env);
      for (
        let i = start;
        step > 0 ? i <= end : i >= end;
        i += step
      ) {
        localEnv.setLocal(s.name, i);
        try {
          await evalStatement(s.block, localEnv);
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
          s.expressions.map((e) => evalExpression(e, env)),
        ),
      ).flatten();
      const iteratorFunction: ILuaFunction | undefined =
        iteratorMultiRes.values[0];
      if (!iteratorFunction?.call) {
        console.error("Cannot iterate over", iteratorMultiRes.values[0]);
        throw new LuaRuntimeError(
          `Cannot iterate over ${iteratorMultiRes.values[0]}`,
          s.ctx,
        );
      }

      const state: LuaValue = iteratorMultiRes.values[1] || null;
      const control: LuaValue = iteratorMultiRes.values[2] || null;

      while (true) {
        const iterResult = new LuaMultiRes(
          await iteratorFunction.call(state, control),
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
          await evalStatement(s.block, localEnv);
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
