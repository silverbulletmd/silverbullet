import type { ASTCtx, LuaExpression, LuaLValue, LuaStatement } from "./ast.ts";
import { evalPromiseValues } from "./util.ts";
import {
  type ILuaFunction,
  type ILuaGettable,
  type ILuaSettable,
  jsToLuaValue,
  LuaBreak,
  luaCall,
  LuaEnv,
  luaEquals,
  LuaFunction,
  luaGet,
  luaIndexValue,
  luaLen,
  type LuaLValueContainer,
  LuaMultiRes,
  LuaReturn,
  LuaRuntimeError,
  luaSet,
  type LuaStackFrame,
  LuaTable,
  luaToString,
  luaTruthy,
  type LuaValue,
  luaValueToJS,
  singleResult,
} from "./runtime.ts";
import {
  ArrayQueryCollection,
  type LuaCollectionQuery,
} from "./query_collection.ts";
import { luaToNumberDetailed } from "./tonumber.ts";

// Wrapper for arithmetical operators
function luaCoerceToNumber(val: unknown): number {
  if (typeof val === "number") {
    return val;
  }
  if (typeof val === "string") {
    const [n, kind] = luaToNumberDetailed(val);
    if (n !== null) {
      // Collapse -0 from integer string input to +0
      if (n === 0 && kind === "int") {
        return 0;
      }
      return n;
    }
  }
  throw new Error(`attempt to perform arithmetic on a non-number`);
}

function isIntOperator(o: string): boolean {
  switch (o) {
    case "+":
    case "-":
    case "*":
    case "%":
    case "//": {
      return true;
    }
    default: {
      return false;
    }
  }
}

// Integer expression detection used to decide +0/-0 preservation
function isIntExpression(
  e: LuaExpression | undefined,
  env: LuaEnv,
): boolean {
  if (!e) {
    return false;
  }
  switch (e.type) {
    case "Number": {
      return e.numericType === "int";
    }
    case "Parenthesized": {
      return isIntExpression(e.expression, env);
    }
    case "Unary": {
      if (e.operator === "-" || e.operator === "+") {
        return isIntExpression(e.argument, env);
      }
      return false;
    }
    case "Binary": {
      if (!isIntOperator(e.operator)) {
        return false;
      }
      return isIntExpression(e.left, env) && isIntExpression(e.right, env);
    }
    case "Variable": {
      const nt = env.getNumericType(e.name);
      return nt === "int";
    }
    default: {
      return false;
    }
  }
}

// Collapse any -0 from pure integer operations
function collapseIntZero(
  result: number,
  leftExpr: LuaExpression,
  rightExpr: LuaExpression,
  op: string,
  env: LuaEnv,
): number {
  if (result === 0 && isIntOperator(op)) {
    if (isIntExpression(leftExpr, env) && isIntExpression(rightExpr, env)) {
      return 0;
    }
  }
  return result;
}

// Decide if unary minus zero should collapse
function collapseUnaryMinus(
  argExpr: LuaExpression,
  value: number,
  env: LuaEnv,
): boolean {
  if (value !== 0) {
    return false;
  }
  if (argExpr.type === "String") {
    // Rely on detailed parse
    const [num, kind] = luaToNumberDetailed(argExpr.value);
    return num === 0 && kind === "int";
  }
  if (argExpr.type === "Variable") {
    // Use tracked numeric type
    return env.getNumericType(argExpr.name) === "int";
  }
  if (argExpr.type === "FunctionCall") {
    // Use static return numeric tagging if available
    const prefix = argExpr.prefix;
    if (prefix.type === "Variable") {
      const fnVal = env.get(prefix.name);
      if (
        fnVal instanceof LuaFunction && fnVal.returnNumericTypes &&
        fnVal.returnNumericTypes.length > 0
      ) {
        return fnVal.returnNumericTypes[0] === "int";
      }
      return true;
    }
    return true;
  }
  return isIntExpression(argExpr, env);
}

async function handleTableFieldSync(
  table: LuaTable,
  field: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<void> {
  switch (field.type) {
    case "PropField": {
      const value = await evalExpression(field.value, env, sf);
      table.set(field.key, singleResult(value), sf);
      break;
    }
    case "DynamicField": {
      const key = await evalExpression(field.key, env, sf);
      const value = await evalExpression(field.value, env, sf);
      table.set(singleResult(key), singleResult(value), sf);
      break;
    }
    case "ExpressionField": {
      const value = await evalExpression(field.value, env, sf);
      if (value instanceof LuaMultiRes) {
        for (const val of value.values) {
          table.set(table.length + 1, val, sf);
        }
      } else {
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
          // Special case: evaluate left before right
          const leftVal = evalExpression(e.left, env, sf);
          if (leftVal instanceof Promise) {
            return leftVal.then((left) => {
              if (luaTruthy(left)) {
                return left;
              }
              return evalExpression(e.right, env, sf);
            });
          } else if (luaTruthy(leftVal)) {
            return leftVal;
          } else {
            return evalExpression(e.right, env, sf);
          }
        } else if (e.operator === "and") {
          // Special case: evaluate left before right
          const leftVal = evalExpression(e.left, env, sf);
          if (leftVal instanceof Promise) {
            return leftVal.then((left) => {
              if (!luaTruthy(left)) {
                return left;
              }
              return evalExpression(e.right, env, sf);
            });
          } else if (!luaTruthy(leftVal)) {
            return leftVal;
          } else {
            return evalExpression(e.right, env, sf);
          }
        }
        const leftEvaluated = evalExpression(e.left, env, sf);
        if (leftEvaluated instanceof Promise) {
          return leftEvaluated.then((left) => {
            const rightEvaluated = evalExpression(e.right, env, sf);
            if (rightEvaluated instanceof Promise) {
              return rightEvaluated.then((right) =>
                finishBinary(e, left, right, env, sf)
              );
            } else {
              return finishBinary(e, left, rightEvaluated, env, sf);
            }
          });
        } else {
          const rightEvaluated = evalExpression(e.right, env, sf);
          if (rightEvaluated instanceof Promise) {
            return rightEvaluated.then((right) =>
              finishBinary(e, leftEvaluated, right, env, sf)
            );
          } else {
            return finishBinary(e, leftEvaluated, rightEvaluated, env, sf);
          }
        }
      }
      case "Unary": {
        const value = evalExpression(e.argument, env, sf);
        if (value instanceof Promise) {
          return value.then((value) => {
            switch (e.operator) {
              case "-": {
                const num = luaCoerceToNumber(singleResult(value));
                if (
                  num === 0 && collapseUnaryMinus(e.argument, num, env)
                ) {
                  return 0;
                }
                return -num;
              }
              case "+":
                return +singleResult(value);
              case "not":
                return !singleResult(value);
              case "~":
                return ~exactInt(singleResult(value), e.ctx, sf);
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
            case "-": {
              const num = luaCoerceToNumber(singleResult(value));
              if (num === 0 && collapseUnaryMinus(e.argument, num, env)) {
                return 0;
              }
              return -num;
            }
            case "+":
              return +singleResult(value);
            case "not":
              return !singleResult(value);
            case "~":
              return ~exactInt(singleResult(value), e.ctx, sf);
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
        return Promise.resolve().then(async () => {
          const table = new LuaTable();

          for (const field of e.fields) {
            await handleTableFieldSync(table, field, env, sf);
          }

          return table;
        });
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
            collection = luaValueToJS(collection, sf);
            // Check if collection is a queryable collection
            if (!collection.query) {
              // If not, try to convert it to JS and see if it's an array
              collection = await luaValueToJS(collection, sf);
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
              distinct: true,
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

function finishBinary(
  e: LuaExpression & { type: "Binary" },
  left: any,
  right: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): any {
  if ((e.operator === "%" || e.operator === "//")) {
    const rightNum = luaCoerceToNumber(singleResult(right));
    if (rightNum === 0) {
      const leftInt = isIntExpression(e.left, env);
      const rightInt = isIntExpression(e.right, env);
      if (leftInt && rightInt) {
        throw new LuaRuntimeError(
          `attempt to ${
            e.operator === "%" ? "perform modulo" : "perform floor division"
          } by zero (integer)`,
          sf.withCtx(e.ctx),
        );
      }
    }
  }
  const result = luaOp(
    e.operator,
    singleResult(left),
    singleResult(right),
    e.ctx,
    sf,
  );
  if (typeof result === "number") {
    return collapseIntZero(result, e.left, e.right, e.operator, env);
  }
  return result;
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
      const obj = evalPrefixExpression(e.object, env, sf);
      const key = evalExpression(e.key, env, sf);
      const values = evalPromiseValues([obj, key]);
      if (values instanceof Promise) {
        return values.then(([table, key]) => {
          table = singleResult(table);
          key = singleResult(key);
          return luaGet(table, key, sf.withCtx(e.ctx));
        });
      } else {
        const table = singleResult(values[0]);
        const keyVal = singleResult(values[1]);
        return luaGet(table, keyVal, sf.withCtx(e.ctx));
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
        // Normal argument handling for hello:there(a, b, c) type calls
        if (e.name) {
          selfArgs = [prefixValue];
          prefixValue = luaIndexValue(prefixValue, e.name, sf);
          if (prefixValue instanceof Promise) {
            return prefixValue.then(handleFunctionCall);
          }
        }

        // Unsure if part of the spec, but it seems to be common for Lua implementations
        // to evaluate all args before evaluating the callee
        const args = evalExpressions(e.args, env, sf);

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
  "+": {
    metaMethod: "__add",
    nativeImplementation: (a, b) => luaCoerceToNumber(a) + luaCoerceToNumber(b),
  },
  "-": {
    metaMethod: "__sub",
    nativeImplementation: (a, b) => luaCoerceToNumber(a) - luaCoerceToNumber(b),
  },
  "*": {
    metaMethod: "__mul",
    nativeImplementation: (a, b) => luaCoerceToNumber(a) * luaCoerceToNumber(b),
  },
  "/": {
    metaMethod: "__div",
    nativeImplementation: (a, b) => luaCoerceToNumber(a) / luaCoerceToNumber(b),
  },
  "//": {
    metaMethod: "__idiv",
    nativeImplementation: (a, b) =>
      Math.floor(luaCoerceToNumber(a) / luaCoerceToNumber(b)),
  },
  "%": {
    metaMethod: "__mod",
    nativeImplementation: (a, b) => luaCoerceToNumber(a) % luaCoerceToNumber(b),
  },
  "^": {
    metaMethod: "__pow",
    nativeImplementation: (a, b) =>
      luaCoerceToNumber(a) ** luaCoerceToNumber(b),
  },
  "&": {
    metaMethod: "__band",
    nativeImplementation: (a, b, ctx, sf) =>
      exactInt(a, ctx, sf) & exactInt(b, ctx, sf),
  },
  "|": {
    metaMethod: "__bor",
    nativeImplementation: (a, b, ctx, sf) =>
      exactInt(a, ctx, sf) | exactInt(b, ctx, sf),
  },
  "~": {
    metaMethod: "__bxor",
    nativeImplementation: (a, b, ctx, sf) =>
      exactInt(a, ctx, sf) ^ exactInt(b, ctx, sf),
  },
  "<<": {
    metaMethod: "__shl",
    nativeImplementation: (a, b, ctx, sf) =>
      exactInt(a, ctx, sf) << exactInt(b, ctx, sf),
  },
  ">>": {
    metaMethod: "__shr",
    nativeImplementation: (a, b, ctx, sf) =>
      exactInt(a, ctx, sf) >> exactInt(b, ctx, sf),
  },
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
  "<": {
    metaMethod: "__lt",
    nativeImplementation: (a, b) => a < b,
  },
  "<=": {
    metaMethod: "__le",
    nativeImplementation: (a, b) => a <= b,
  },
  ">": {
    nativeImplementation: (a, b, ctx, sf) => !luaOp("<=", a, b, ctx, sf),
  },
  ">=": {
    nativeImplementation: (a, b, ctx, sf) => !luaOp("<", a, b, ctx, sf),
  },
  "and": {
    metaMethod: "__and",
    nativeImplementation: (a, b) => a && b,
  },
  "or": {
    metaMethod: "__or",
    nativeImplementation: (a, b) => a || b,
  },
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

function evalExpressions(
  es: LuaExpression[],
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue[]> | LuaValue[] {
  const argsVal = evalPromiseValues(
    es.map((arg) => evalExpression(arg, env, sf)),
  );
  if (argsVal instanceof Promise) {
    return argsVal.then((argsResolved) =>
      new LuaMultiRes(argsResolved).flatten().values
    );
  } else {
    return new LuaMultiRes(argsVal).flatten().values;
  }
}

/**
 * Evaluates an expression in two possible modes:
 * 1. with `returnOnReturn` set to `true` will return the value of a return statement
 * 2. with `returnOnReturn` set to `false` will throw a LuaReturn exception if a return statement is encountered
 */
export async function evalStatement(
  s: LuaStatement,
  env: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn = false,
): Promise<void | LuaValue[]> {
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
          const name = s.names[i].name;
          const expr = s.expressions[i];
          let nt: "int" | "float" | undefined;
          if (expr && expr.type === "Number") {
            nt = expr.numericType;
          } else if (
            expr && expr.type === "Unary" &&
            (expr.operator === "-" || expr.operator === "+") &&
            expr.argument.type === "Number"
          ) {
            nt = expr.argument.numericType;
          } else if (
            expr && typeof values[i] === "number" &&
            isIntExpression(expr, env)
          ) {
            nt = "int";
          }
          env.setLocal(name, values[i], nt);
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
      throw new Error("Labels and gotos are not supported");
    case "Block": {
      const newEnv = new LuaEnv(env);
      for (const statement of s.statements) {
        const result = await evalStatement(
          statement,
          newEnv,
          sf,
          returnOnReturn,
        );
        // Will only happen with `return` statement
        if (result !== undefined) {
          return result;
        }
      }
      break;
    }
    case "If": {
      for (const cond of s.conditions) {
        if (luaTruthy(await evalExpression(cond.condition, env, sf))) {
          await evalStatement(cond.block, env, sf);
          return;
        }
      }
      if (s.elseBlock) {
        await evalStatement(s.elseBlock, env, sf);
        return;
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
      await evalExpression(s.call, env, sf);
      return;
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
      if (returnOnReturn) {
        return await evalPromiseValues(
          s.expressions.map((value) => evalExpression(value, env, sf)),
        );
      } else {
        throw new LuaReturn(
          await evalPromiseValues(
            s.expressions.map((value) => evalExpression(value, env, sf)),
          ),
        );
      }
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

function exactInt(
  num: number,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): number {
  // See conversion from float to integer https://www.lua.org/manual/5.4/manual.html#3.4.3

  if (!Number.isInteger(num)) {
    throw new LuaRuntimeError(
      `Number ${num} has no integer representation (consider math.floor or math.ceil)`,
      sf.withCtx(ctx),
    );
  }
  return num;
}
