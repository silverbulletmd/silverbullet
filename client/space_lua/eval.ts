import type {
  ASTCtx,
  LuaExpression,
  LuaFunctionBody,
  LuaLValue,
  LuaStatement,
} from "./ast.ts";
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
  type NumKind,
  singleResult,
} from "./runtime.ts";
import {
  ArrayQueryCollection,
  type LuaCollectionQuery,
} from "./query_collection.ts";
import { luaToNumber } from "./tonumber.ts";

function isPromiseLike<T = unknown>(v: unknown): v is Promise<T> {
  return typeof (v as any)?.then === "function";
}

function hasCall(v: unknown): v is ILuaFunction {
  return !!v && typeof (v as any).call === "function";
}

interface LuaFunctionLike {
  body: LuaFunctionBody;
  call: (
    sf: LuaStackFrame,
    ...args: LuaValue[]
  ) => Promise<LuaValue> | LuaValue;
}

function isLuaFunctionLike(v: unknown): v is LuaFunctionLike {
  if (v instanceof LuaFunction) {
    return true;
  }

  const b = (v as any)?.body;
  const stmts = b?.block?.statements;

  return (
    !!v && typeof (v as any).call === "function" &&
    !!b && Array.isArray(stmts)
  );
}

function luaCoerceToNumber(val: unknown): number {
  if (typeof val === "number") {
    // No need to coerce
    return val;
  }
  if (typeof val === "string") {
    const s = val.trim();
    const n = luaToNumber(s);
    if (n !== null) {
      if (n === 0 && /^[+-]?\d+$/.test(s)) {
        return 0;
      }
      return n;
    }
  }
  throw new Error(
    `Attempting to perform arithmetic operation on a ${typeof val} value`,
  );
}

function kindCombine(a: NumKind, b: NumKind): NumKind {
  if (a === "float" || b === "float") {
    return "float";
  }
  if (a === "unknown" || b === "unknown") {
    return "unknown";
  }
  return "int";
}

function exprKind(e: LuaExpression, env: LuaEnv): NumKind {
  return exprKindFnAware(e, env, null, new Set());
}

function exprKindFnAware(
  e: LuaExpression,
  env: LuaEnv,
  currentFn: LuaFunctionLike | null,
  seenFns: Set<LuaFunctionLike>,
): NumKind {
  switch (e.type) {
    case "Number": {
      return e.numericType === "int" ? "int" : "float";
    }
    case "Parenthesized": {
      return exprKindFnAware(e.expression, env, currentFn, seenFns);
    }
    case "Unary": {
      if (e.operator === "-") {
        return exprKindFnAware(e.argument, env, currentFn, seenFns);
      }
      return "unknown";
    }
    case "Binary": {
      const op = e.operator;
      if (op === "/") {
        return "float";
      }
      if (!["+", "-", "*", "%", "//", "&", "|", "~", "<<", ">>"].includes(op)) {
        return "float";
      }
      const kl = exprKindFnAware(e.left, env, currentFn, seenFns);
      const kr = exprKindFnAware(e.right, env, currentFn, seenFns);
      if (kl === "int" && kr === "int") {
        return "int";
      }
      if (kl === "float" || kr === "float") {
        return "float";
      }
      return "unknown";
    }
    case "Variable": {
      return env.getNumKind(e.name);
    }
    case "FunctionCall": {
      if (e.name) {
        return "unknown";
      }
      if (e.prefix.type !== "Variable") {
        return "unknown";
      }
      const callee = env.get(e.prefix.name);
      if (isPromiseLike(callee)) {
        return "unknown";
      }
      if (isLuaFunctionLike(callee)) {
        const fn = callee as LuaFunctionLike;
        if (currentFn && fn === currentFn) {
          return "int";
        }
        return inferFunctionReturnKind(fn, env, seenFns);
      }
      return "unknown";
    }
    default:
      return "unknown";
  }
}

function inferFunctionReturnKind(
  fn: LuaFunctionLike,
  env: LuaEnv,
  seenFns: Set<LuaFunctionLike> = new Set(),
): NumKind {
  if (seenFns.has(fn)) {
    return "int"; // recursion
  }
  seenFns.add(fn);
  function walkStmt(s: any): NumKind | null {
    switch (s.type) {
      case "Return": {
        if (!s.expressions || s.expressions.length === 0) {
          return "unknown";
        }
        return exprKindFnAware(s.expressions[0], env, fn, seenFns);
      }
      case "Block": {
        let res: NumKind | null = null;
        for (const st of s.statements) {
          const k = walkStmt(st);
          res = res === null ? k : (k === null ? res : kindCombine(res, k));
        }
        return res;
      }
      case "If": {
        let res: NumKind | null = null;
        for (const c of s.conditions) {
          const k = walkStmt(c.block);
          res = res === null ? k : (k === null ? res : kindCombine(res, k));
        }
        if (s.elseBlock) {
          const k = walkStmt(s.elseBlock);
          res = res === null ? k : (k === null ? res : kindCombine(res, k));
        }
        return res;
      }
      case "While":
      case "Repeat":
      case "For": {
        return walkStmt(s.block);
      }
      default: {
        return null;
      }
    }
  }
  const k = walkStmt(fn.body.block);
  return k === null ? "unknown" : k;
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
      case "String": {
        return e.value;
      }
      case "Number": {
        return e.value;
      }
      case "Boolean": {
        return e.value;
      }
      case "Nil": {
        return null;
      }
      case "Binary": {
        if (e.operator === "or") {
          const left = evalExpression(e.left, env, sf);
          return left instanceof Promise
            ? left.then((lv) => (
              luaTruthy(lv) ? lv : evalExpression(e.right, env, sf)
            ))
            : (
              luaTruthy(left) ? left : evalExpression(e.right, env, sf)
            );
        } else if (e.operator === "and") {
          const left = evalExpression(e.left, env, sf);
          return left instanceof Promise
            ? left.then((lv) => (
              !luaTruthy(lv) ? lv : evalExpression(e.right, env, sf)
            ))
            : (
              !luaTruthy(left) ? left : evalExpression(e.right, env, sf)
            );
        }
        // strict left-to-right evaluation for binary ops
        const left = evalExpression(e.left, env, sf);
        const evalRightThenApply = (lval: any): any => {
          const right = evalExpression(e.right, env, sf);
          const apply = (rval: any): any => {
            const leftKind = exprKind(e.left, env);
            const rightKind = exprKind(e.right, env);

            if (e.operator === "%" || e.operator === "//") {
              const na = luaCoerceToNumber(singleResult(lval));
              const nb = luaCoerceToNumber(singleResult(rval));
              const bothInt = leftKind === "int" && rightKind === "int";
              if (e.operator === "%") {
                if (nb === 0) {
                  if (bothInt) {
                    throw new LuaRuntimeError(
                      `Attempting to perform modulo by zero`,
                      sf.withCtx(e.ctx),
                    );
                  } else {
                    return NaN; // float modulo by zero -> NaN
                  }
                }
                const mod = na % nb;
                if (mod === 0 && bothInt) {
                  return 0;
                }
                return mod;
              } else {
                if (nb === 0) {
                  if (bothInt) {
                    throw new LuaRuntimeError(
                      `Attempting to divide by zero`,
                      sf.withCtx(e.ctx),
                    );
                  } else {
                    // float floor division by zero yields +Inf/-Inf
                    return Math.floor(na / nb);
                  }
                }
                return Math.floor(na / nb);
              }
            }
            const res = luaOp(
              e.operator,
              singleResult(lval),
              singleResult(rval),
              e.ctx,
              sf,
            );
            // integer zero normalization for +, -, *, %
            if (
              res === 0 &&
              (e.operator === "+" || e.operator === "-" || e.operator === "*" ||
                e.operator === "%") &&
              leftKind === "int" &&
              rightKind === "int"
            ) {
              return 0;
            }
            return res;
          };
          return right instanceof Promise ? right.then(apply) : apply(right);
        };
        return left instanceof Promise
          ? left.then(evalRightThenApply)
          : evalRightThenApply(left);
      }
      case "Unary": {
        const value = evalExpression(e.argument, env, sf);
        const handle = (v: any) => {
          switch (e.operator) {
            case "-": {
              // Literal int -(0) => +0
              if (
                e.argument.type === "Number" &&
                e.argument.numericType === "int" &&
                e.argument.value === 0
              ) {
                return 0;
              }
              const n = luaCoerceToNumber(singleResult(v));
              const k = exprKind(e.argument, env);
              if (n === 0) {
                if (k === "int") return 0;
                if (e.argument.type === "String") {
                  const s = (e.argument.value as string).trim();
                  if (/^[+-]?\d+$/.test(s)) {
                    return 0;
                  }
                }
              }
              return -n;
            }
            case "not": {
              return !singleResult(v);
            }
            case "~": {
              return ~exactInt(singleResult(v), e.ctx, sf);
            }
            case "#": {
              return luaLen(singleResult(v));
            }
            default: {
              throw new Error(`Unknown unary operator ${e.operator}`);
            }
          }
        };
        return value instanceof Promise ? value.then(handle) : handle(value);
      }
      case "Variable":
      case "FunctionCall":
      case "TableAccess":
      case "PropertyAccess": {
        return evalPrefixExpression(e, env, sf);
      }
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
            if (!collection.query) {
              collection = await luaValueToJS(collection, sf);
              if (!Array.isArray(collection)) {
                throw new LuaRuntimeError(
                  "Collection does not support query",
                  sf.withCtx(e.ctx),
                );
              }
              collection = new ArrayQueryCollection(collection);
            }
            const query: LuaCollectionQuery = {
              objectVariable,
              distinct: true,
            };
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
      }
      return value;
    }
    case "Parenthesized": {
      return evalExpression(e.expression, env, sf);
    }
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
    case "PropertyAccess": {
      const obj = evalPrefixExpression(e.object, env, sf);
      return obj instanceof Promise
        ? obj.then((o) => luaGet(o, e.property, sf.withCtx(e.ctx)))
        : luaGet(obj, e.property, sf.withCtx(e.ctx));
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
        pv: LuaValue,
      ): LuaValue | Promise<LuaValue> => {
        // Method call a:b(...): inject self as first arg
        if (e.name) {
          selfArgs = [pv];
          pv = luaIndexValue(pv, e.name, sf);
          if (pv instanceof Promise) {
            return pv.then(handleFunctionCall);
          }
        }
        // Evaluate args before callee
        const args = evalExpressions(e.args, env, sf);
        if (args instanceof Promise) {
          return args.then((argv) =>
            luaCall(pv, [...selfArgs, ...argv], e.ctx, sf)
          );
        } else {
          return luaCall(pv, [...selfArgs, ...args], e.ctx, sf);
        }
      };
      return prefixValue instanceof Promise
        ? prefixValue.then(handleFunctionCall)
        : handleFunctionCall(prefixValue);
    }
    default:
      throw new Error(`Unknown prefix expression type ${e.type}`);
  }
}

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
    if (!sf) {
      console.warn(
        "metatable lookup with string value but no stack frame, returning nil",
      );
      return null;
    }
    const global = sf.threadLocal.get("_GLOBAL");
    if (!global) {
      console.warn(
        "metatable lookup with string value but no _GLOBAL, returning nil",
      );
      return null;
    }
    const stringMetatable = new LuaTable();
    stringMetatable.set("__index", global.get("string"));
    return stringMetatable;
  }

  return (value as any)?.metatable ?? null;
}

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
      const aStr = luaToString(a);
      const bStr = luaToString(b);
      if (aStr instanceof Promise || bStr instanceof Promise) {
        return Promise.all([aStr, bStr]).then(([as, bs]) => as + bs);
      } else {
        return aStr + bStr;
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
    if (metaResult !== undefined) return metaResult;
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

export async function evalStatement(
  s: LuaStatement,
  env: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn = false,
): Promise<void | LuaValue[]> {
  switch (s.type) {
    case "Assignment": {
      const values = await evalExpressions(s.expressions, env, sf);
      const lvalues = await evalPromiseValues(s.variables.map(
        (lval) => evalLValue(lval, env, sf),
      ));
      for (let i = 0; i < lvalues.length; i++) {
        const container = lvalues[i];
        const val = values[i];
        await luaSet(container.env, container.key, val, sf.withCtx(s.ctx));
        // Tag variable numeric kind on assignment
        if (
          container.env instanceof LuaEnv &&
          typeof container.key === "string"
        ) {
          const rhsExpr = s.expressions[i];
          const k: NumKind = rhsExpr ? exprKind(rhsExpr, env) : "unknown";
          (container.env as LuaEnv).setNumKind(container.key, k);
        }
      }
      break;
    }
    case "Local": {
      if (s.expressions && s.expressions.length > 0) {
        const values = await evalExpressions(s.expressions, env, sf);
        for (let i = 0; i < s.names.length; i++) {
          const name = s.names[i].name;
          const val = values[i];
          env.setLocal(name, val);
          const rhsExpr = s.expressions[i];
          const k: NumKind = rhsExpr ? exprKind(rhsExpr, env) : "unknown";
          env.setNumKind(name, k);
        }
      } else {
        for (let i = 0; i < s.names.length; i++) {
          env.setLocal(s.names[i].name, null);
          env.setNumKind(s.names[i].name, "unknown");
        }
      }
      break;
    }
    case "Semicolon": {
      break;
    }
    case "Label":
    case "Goto": {
      throw new Error("Labels and gotos are not supported");
    }
    case "Block": {
      const newEnv = new LuaEnv(env);
      for (const statement of s.statements) {
        const result = await evalStatement(
          statement,
          newEnv,
          sf,
          returnOnReturn,
        );
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
        // function a:b(...) -> function a.b(self, ...)
        body = { ...s.body, parameters: ["self", ...s.body.parameters] };
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
      settable.set(propNames[propNames.length - 1], new LuaFunction(body, env));
      break;
    }
    case "LocalFunction": {
      env.setLocal(s.name, new LuaFunction(s.body, env));
      break;
    }
    case "Return": {
      if (returnOnReturn) {
        return await evalPromiseValues(s.expressions.map(
          (value) => evalExpression(value, env, sf),
        ));
      } else {
        throw new LuaReturn(
          await evalPromiseValues(s.expressions.map(
            (value) => evalExpression(value, env, sf),
          )),
        );
      }
    }
    case "For": {
      const start = await evalExpression(s.start, env, sf);
      const end = await evalExpression(s.end, env, sf);
      const step = s.step ? await evalExpression(s.step, env, sf) : 1;
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
        const localEnv = new LuaEnv(env);
        localEnv.setLocal(s.name, i);
        const k: NumKind = (typeof i === "number" && Number.isInteger(i))
          ? "int"
          : "float";
        localEnv.setNumKind(s.name, k);
        try {
          await evalStatement(s.block, localEnv, sf);
        } catch (e: any) {
          if (e instanceof LuaBreak) break;
          throw e;
        }
      }
      break;
    }
    case "ForIn": {
      const iteratorMultiRes = new LuaMultiRes(
        await evalPromiseValues(s.expressions.map(
          (e) => evalExpression(e, env, sf),
        )),
      ).flatten();
      let iteratorValue: ILuaFunction | any = iteratorMultiRes.values[0];
      if (Array.isArray(iteratorValue) || iteratorValue instanceof LuaTable) {
        iteratorValue = (env.get("each") as ILuaFunction).call(
          sf,
          iteratorValue,
        );
      }
      if (!hasCall(iteratorValue)) {
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
          await iteratorValue.call(sf, state, control),
        ).flatten();
        if (
          iterResult.values[0] === null ||
          iterResult.values[0] === undefined
        ) {
          break;
        }
        const localEnv = new LuaEnv(env);
        for (let i = 0; i < s.names.length; i++) {
          const v = iterResult.values[i];
          localEnv.setLocal(s.names[i], v);
          const k: NumKind = (typeof v === "number" && Number.isInteger(v))
            ? "int"
            : "float";
          localEnv.setNumKind(s.names[i], k);
        }
        try {
          await evalStatement(s.block, localEnv, sf);
        } catch (e: any) {
          if (e instanceof LuaBreak) break;
          throw e;
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
    case "Variable": {
      return { env, key: lval.name };
    }
    case "TableAccess": {
      const objValue = evalExpression(lval.object, env, sf);
      const keyValue = evalExpression(lval.key, env, sf);
      if (objValue instanceof Promise || keyValue instanceof Promise) {
        return Promise.all([
          objValue instanceof Promise ? objValue : Promise.resolve(objValue),
          keyValue instanceof Promise ? keyValue : Promise.resolve(keyValue),
        ]).then(([objV, keyV]) => ({
          env: singleResult(objV),
          key: singleResult(keyV),
        }));
      } else {
        return { env: singleResult(objValue), key: singleResult(keyValue) };
      }
    }
    case "PropertyAccess": {
      const objValue = evalExpression(lval.object, env, sf);
      return objValue instanceof Promise
        ? objValue.then((ov) => ({ env: ov, key: lval.property }))
        : { env: objValue, key: lval.property };
    }
  }
}

function exactInt(
  num: number,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): number {
  if (!Number.isInteger(num)) {
    throw new LuaRuntimeError(
      `Number ${num} has no integer representation`,
      sf.withCtx(ctx),
    );
  }
  return num;
}
