import type {
  ASTCtx,
  LuaBlock,
  LuaExpression,
  LuaLValue,
  LuaStatement,
  NumericType,
} from "./ast.ts";
import { LuaAttribute } from "./ast.ts";
import { evalPromiseValues } from "./util.ts";
import {
  getMetatable,
  type ILuaFunction,
  type ILuaGettable,
  type ILuaSettable,
  jsToLuaValue,
  luaCall,
  luaCloseFromMark,
  luaEnsureCloseStack,
  LuaEnv,
  luaEquals,
  LuaFunction,
  luaGet,
  luaIndexValue,
  type LuaLValueContainer,
  luaMarkToBeClosed,
  LuaMultiRes,
  LuaRuntimeError,
  luaSet,
  type LuaStackFrame,
  LuaTable,
  luaTruthy,
  type LuaType,
  luaTypeName,
  luaTypeOf,
  type LuaValue,
  luaValueToJS,
  singleResult,
} from "./runtime.ts";
import {
  ArrayQueryCollection,
  type LuaCollectionQuery,
} from "./query_collection.ts";
import {
  boxZero,
  coerceNumeric,
  coerceNumericPair,
  floatLiteral,
  getNumericKind,
  getZeroBoxKind,
  isFloatTag,
  isNegativeZero,
  type LuaFloatTag,
  luaStringCoercionError,
  type OpHints,
  untagNumber,
} from "./numeric.ts";
import { isPromise, rpAll, rpThen } from "./rp.ts";
import {
  asAssignment,
  asBinary,
  asBlock,
  asFor,
  asForIn,
  asFunctionCall,
  asFunctionCallStmt,
  asFunctionDef,
  asFunctionStmt,
  asGoto,
  asIf,
  asLabel,
  asLocal,
  asLocalFunction,
  asLValuePropertyAccess,
  asLValueTableAccess,
  asLValueVariable,
  asParenthesized,
  asPropertyAccess,
  asQueryExpr,
  asRepeat,
  asReturn,
  asTableAccess,
  asTableConstructor,
  asUnary,
  asVariable,
  asWhile,
} from "./ast_narrow.ts";
import { getBlockGotoMeta } from "./labels.ts";

type GotoSignal = { ctrl: "goto"; target: string };
type ReturnSignal = { ctrl: "return"; values: LuaValue[] };
type BreakSignal = { ctrl: "break" };
type ControlSignal = GotoSignal | ReturnSignal | BreakSignal;

function isGotoSignal(v: any): v is GotoSignal {
  return !!v && typeof v === "object" && v.ctrl === "goto";
}

function isBreakSignal(v: any): v is BreakSignal {
  return !!v && typeof v === "object" && v.ctrl === "break";
}

function consumeGotoInBlock(
  res: any,
  labels: Map<string, number>,
): number | any | undefined {
  if (res === undefined) {
    return undefined;
  }
  if (isGotoSignal(res)) {
    const labelIdx = labels.get(res.target);
    if (labelIdx !== undefined) {
      return labelIdx + 1; // next statement
    }
  }
  return res;
}

function blockMetaOrThrow(
  block: LuaBlock,
  sf: LuaStackFrame,
): ReturnType<typeof getBlockGotoMeta> {
  try {
    return getBlockGotoMeta(block);
  } catch (e: any) {
    if (e && typeof e === "object" && "astCtx" in e) {
      throw new LuaRuntimeError(e.message, sf.withCtx((e as any).astCtx));
    }
    throw e;
  }
}

// Queryable guard to avoid `(collection as any).query` usage
type Queryable = {
  query: (
    q: LuaCollectionQuery,
    env: LuaEnv,
    sf: LuaStackFrame,
  ) => Promise<any>;
};
function isQueryable(x: unknown): x is Queryable {
  return !!x && typeof (x as any).query === "function";
}

function arithVerbFromOperator(op: string): string | null {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "//":
      return "idiv";
    case "%":
      return "mod";
    case "^":
      return "pow";
    default:
      return null;
  }
}

function maybeLuaArithStringError(
  op: string,
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaRuntimeError | null {
  const verb = arithVerbFromOperator(op);
  if (!verb) {
    return null;
  }

  const ta = luaTypeName(a);
  const tb = luaTypeName(b);

  if (ta === "string" || tb === "string") {
    return new LuaRuntimeError(
      `attempt to ${verb} a '${ta}' with a '${tb}'`,
      sf.withCtx(ctx),
    );
  }

  return null;
}

// Normalize arithmetic result based on operation mode:
// * integer operations: -0 becomes +0, integer results stay plain,
// * float operations:   -0 stays   -0, integer results tagged as float.
function normalizeArithmeticResult(
  r: number,
  bothInt: boolean,
): number | LuaFloatTag {
  if (r === 0) {
    if (isNegativeZero(r)) {
      return bothInt ? 0 : -0;
    }
    return bothInt ? 0 : boxZero("float");
  }

  if (!bothInt && Number.isInteger(r)) {
    return floatLiteral(r);
  }

  return r;
}

function luaFloorDiv(
  a: unknown,
  b: unknown,
  ctx: ASTCtx,
  sf: LuaStackFrame,
  hints?: OpHints,
): number {
  const { ax, bx, bothInt } = coerceNumericPair(a, b, hints);
  if (bothInt && bx === 0) {
    throw new LuaRuntimeError(
      `attempt to divide by zero`,
      sf.withCtx(ctx),
    );
  }

  const q = Math.floor(ax / bx);
  if (q === 0) {
    if (bothInt) {
      return 0;
    }
    return isNegativeZero(q) ? -0 : boxZero("float");
  }
  return q;
}

function luaMod(
  a: unknown,
  b: unknown,
  ctx: ASTCtx,
  sf: LuaStackFrame,
  hints?: OpHints,
): number {
  const { ax, bx, bothInt } = coerceNumericPair(a, b, hints);
  if (bothInt && bx === 0) {
    throw new LuaRuntimeError(
      `attempt to perform 'n%0'`,
      sf.withCtx(ctx),
    );
  }

  const q = Math.floor(ax / bx);
  const r = ax - q * bx;
  if (r === 0) {
    if (isNegativeZero(ax)) {
      return -0;
    }
    return bothInt ? 0 : boxZero("float");
  }
  return r;
}

function luaLess(
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): boolean {
  const { ta, tb, av, bv } = luaRelOperands(a, b);

  if (ta === "number" && tb === "number") {
    return av < bv;
  }

  if (ta === "string" && tb === "string") {
    return av < bv;
  }

  throw new LuaRuntimeError(
    `attempt to compare ${ta} with ${tb}`,
    sf.withCtx(ctx),
  );
}

function luaLessEqual(
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): boolean {
  const { ta, tb, av, bv } = luaRelOperands(a, b);

  if (ta === "number" && tb === "number") {
    return av <= bv;
  }

  if (ta === "string" && tb === "string") {
    return av <= bv;
  }

  throw new LuaRuntimeError(
    `attempt to compare ${ta} with ${tb}`,
    sf.withCtx(ctx),
  );
}

function luaUnaryMinus(v: any): number {
  const { n, zeroKind } = coerceNumeric(v);

  if (n === 0) {
    const origKind = getZeroBoxKind(v);
    const isFloat = origKind === "float" || zeroKind === "float" ||
      isFloatTag(v);

    // If it's a float zero for sure, flip the sign
    if (isFloat) {
      return isNegativeZero(v) || isNegativeZero(n) ? 0 : -0;
    }
    return 0;
  }

  return -n;
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

// Unwrap parentheses and unary +/- around a numeric literal
function astNumberKind(e: LuaExpression | undefined): NumericType | undefined {
  if (!e) {
    return undefined;
  }
  while (e.type === "Parenthesized") {
    e = e.expression;
  }
  if (e.type === "Unary" && (e.operator === "-" || e.operator === "+")) {
    return astNumberKind(e.argument);
  }
  if (e.type === "Number") {
    return e.numericType === "int" ? "int" : "float";
  }
  return undefined;
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
        if (e.value === 0 && !isNegativeZero(e.value)) {
          return e.numericType === "int" ? 0 : boxZero("float");
        }
        if (e.numericType === "float" && Number.isInteger(e.value)) {
          return floatLiteral(e.value);
        }
        return e.value;
      }
      case "Boolean": {
        return e.value;
      }
      case "Nil": {
        return null;
      }
      case "Binary": {
        const b = asBinary(e);
        if (b.operator === "or") {
          // Special case: eagerly evaluate left before even attempting right
          return evalLogical("or", b.left, b.right, env, sf);
        } else if (b.operator === "and") {
          // Special case: eagerly evaluate left before even attempting right
          return evalLogical("and", b.left, b.right, env, sf);
        }
        // Enforce left-to-right evaluation
        const hints: OpHints = opHintsFromBinary(b);
        return evalBinaryWithLR(
          b.operator,
          b.left,
          b.right,
          b.ctx,
          env,
          sf,
          hints,
        );
      }
      case "Unary": {
        const u = asUnary(e);
        if (u.operator === "-" && u.argument.type === "Number") {
          const num = u.argument;
          if (num.value === 0 && !isNegativeZero(num.value)) {
            if (num.numericType === "float") {
              return -0;
            } else {
              return 0;
            }
          }
          return num.numericType === "float" && Number.isInteger(-num.value)
            ? floatLiteral(-num.value)
            : -num.value;
        }
        const value = evalExpression(u.argument, env, sf);

        const apply = (value: LuaValue) => {
          switch (u.operator) {
            case "-": {
              const arg = singleResult(value);
              return unaryWithMeta(
                arg,
                "__unm",
                u.ctx,
                sf,
                () => {
                  if (typeof arg === "string") {
                    try {
                      coerceNumeric(arg);
                    } catch (_e: any) {
                      throw new LuaRuntimeError(
                        "attempt to unm a 'string' with a 'string'",
                        sf.withCtx(u.ctx),
                      );
                    }
                  }
                  return luaUnaryMinus(arg);
                },
              );
            }
            case "+": {
              return +singleResult(value);
            }
            case "not": {
              return !luaTruthy(value);
            }
            case "~": {
              const arg = singleResult(value);
              return unaryWithMeta(
                arg,
                "__bnot",
                u.ctx,
                sf,
                () => ~exactInt(arg, u.ctx, sf),
              );
            }
            case "#": {
              return luaLengthOp(singleResult(value), u.ctx, sf);
            }
            default: {
              throw new LuaRuntimeError(
                `Unknown unary operator ${u.operator}`,
                sf.withCtx(u.ctx),
              );
            }
          }
        };

        return rpThen(value, apply);
      }

      case "Variable":
      case "FunctionCall":
      case "TableAccess":
      case "PropertyAccess": {
        return evalPrefixExpression(e, env, sf);
      }
      case "TableConstructor": {
        const tc = asTableConstructor(e);
        return Promise.resolve().then(async () => {
          const table = new LuaTable();

          for (const field of tc.fields) {
            await handleTableFieldSync(table, field, env, sf);
          }

          return table;
        });
      }
      case "FunctionDefinition": {
        const fd = asFunctionDef(e);
        return new LuaFunction(fd.body, env);
      }
      case "Query": {
        const q = asQueryExpr(e);
        const findFromClause = q.clauses.find((c) => c.type === "From");
        if (!findFromClause) {
          throw new LuaRuntimeError(
            "No from clause found",
            sf.withCtx(q.ctx),
          );
        }
        const objectVariable = findFromClause.name;
        const objectExpression = findFromClause.expression;
        return Promise.resolve(evalExpression(objectExpression, env, sf)).then(
          async (collection: LuaValue) => {
            if (!collection) {
              throw new LuaRuntimeError(
                "Collection is nil",
                sf.withCtx(q.ctx),
              );
            }
            if (collection instanceof LuaTable && collection.empty()) {
              // Make sure we're converting an empty result to an array to "query"
              collection = [];
            } else {
              collection = luaValueToJS(collection, sf);
            }
            // Check if collection is a queryable collection
            if (!isQueryable(collection)) {
              if (!Array.isArray(collection)) {
                throw new LuaRuntimeError(
                  "Collection does not support query",
                  sf.withCtx(q.ctx),
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
            for (const clause of q.clauses) {
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

            return (collection as Queryable).query(query, env, sf).then(
              jsToLuaValue,
            );
          },
        );
      }
      default:
        throw new LuaRuntimeError(
          `Unknown expression type ${e.type}`,
          sf.withCtx(e.ctx),
        );
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
      const v = asVariable(e);
      const value = env.get(v.name);
      if (value === undefined) {
        return null;
      } else {
        return value;
      }
    }
    case "Parenthesized": {
      const p = asParenthesized(e);
      return evalExpression(p.expression, env, sf);
    }
    // <<expr>>[<<expr>>]
    case "TableAccess": {
      const ta = asTableAccess(e);
      // Sync-first: evaluate object and key without allocating Promise when both are sync.
      const objV = evalPrefixExpression(ta.object, env, sf);
      const keyV = evalExpression(ta.key, env, sf);

      if (!isPromise(objV) && !isPromise(keyV)) {
        const table = singleResult(objV);
        const key = singleResult(keyV);
        return luaGet(table, key, ta.ctx, sf);
      }

      return rpThen(
        objV,
        (obj) =>
          rpThen(
            keyV,
            (key) => luaGet(singleResult(obj), singleResult(key), ta.ctx, sf),
          ),
      );
    }
    // <expr>.property
    case "PropertyAccess": {
      const pa = asPropertyAccess(e);
      // Sync-first: evaluate object; avoid Promise when object is sync.
      const objV = evalPrefixExpression(pa.object, env, sf);
      if (!isPromise(objV)) {
        return luaGet(objV, pa.property, pa.ctx, sf);
      }
      return rpThen(objV, (obj) => luaGet(obj, pa.property, pa.ctx, sf));
    }
    case "FunctionCall": {
      const fc = asFunctionCall(e);
      const prefixValue = evalPrefixExpression(fc.prefix, env, sf);
      if (prefixValue === null || prefixValue === undefined) {
        const nilMsg = fc.prefix.type === "Variable"
          ? `attempt to call a nil value (global '${
            asVariable(fc.prefix).name
          }')`
          : `attempt to call a nil value`;
        throw new LuaRuntimeError(
          nilMsg,
          sf.withCtx(fc.prefix.ctx),
        );
      }

      let selfArgs: LuaValue[] = [];

      const handleFunctionCall = (
        calleeVal: LuaValue,
      ): LuaValue | Promise<LuaValue> => {
        // Normal argument handling for hello:there(a, b, c) type calls
        if (fc.name) {
          selfArgs = [calleeVal];
          calleeVal = luaIndexValue(calleeVal, fc.name, sf);

          if (isPromise(calleeVal)) {
            return (calleeVal as Promise<any>).then(handleFunctionCall);
          }
        }

        const argsVal = evalExpressions(fc.args, env, sf);

        const thenCall = (args: LuaValue[]) =>
          luaCall(calleeVal, [...selfArgs, ...args], fc.ctx, sf);

        return rpThen(argsVal, thenCall);
      };

      return rpThen(prefixValue, handleFunctionCall);
    }
    default: {
      throw new LuaRuntimeError(
        `Unknown prefix expression type ${e.type}`,
        sf.withCtx(e.ctx),
      );
    }
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

// Unary metamethod lookup and call
function evalUnaryMetamethod(
  value: any,
  metaMethod: "__unm" | "__bnot",
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaValue | Promise<LuaValue> | undefined {
  const mt = getMetatable(value, sf);
  if (mt?.has(metaMethod)) {
    const fn = mt.get(metaMethod);
    return luaCall(fn, [value], ctx, sf);
  }
  return undefined;
}

// Unary metamethod handling (with fallback)
function unaryWithMeta(
  arg: any,
  meta: "__unm" | "__bnot",
  ctx: ASTCtx,
  sf: LuaStackFrame,
  fallback: () => any,
): any {
  const mm = evalUnaryMetamethod(arg, meta, ctx, sf);

  if (mm !== undefined) {
    return isPromise(mm)
      ? (mm as Promise<any>).then(singleResult)
      : singleResult(mm);
  }
  return fallback();
}

// Logical short-circuit evaluation
function evalLogical(
  op: "and" | "or",
  leftExpr: LuaExpression,
  rightExpr: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
): any {
  const left = evalExpression(leftExpr, env, sf);

  const decide = (lv: any) => {
    if (op === "or") {
      if (luaTruthy(lv)) {
        return singleResult(lv);
      }
      const rv = evalExpression(rightExpr, env, sf);
      return isPromise(rv)
        ? (rv as Promise<any>).then(singleResult)
        : singleResult(rv);
    } else {
      if (!luaTruthy(lv)) {
        return singleResult(lv);
      }
      const rv = evalExpression(rightExpr, env, sf);
      return isPromise(rv)
        ? (rv as Promise<any>).then(singleResult)
        : singleResult(rv);
    }
  };

  if (isPromise(left)) {
    return (left as Promise<any>).then(decide);
  } else {
    return decide(left);
  }
}

function opHintsFromBinary(
  e: Extract<LuaExpression, { type: "Binary" }>,
): OpHints {
  return {
    leftKind: astNumberKind(e.left),
    rightKind: astNumberKind(e.right),
  };
}

function evalBinaryWithLR(
  op: string,
  leftExpr: LuaExpression,
  rightExpr: LuaExpression,
  ctx: ASTCtx,
  env: LuaEnv,
  sf: LuaStackFrame,
  hints?: OpHints,
): any {
  const leftVal = evalExpression(leftExpr, env, sf);

  if (!isPromise(leftVal)) {
    const rightVal = evalExpression(rightExpr, env, sf);
    if (!isPromise(rightVal)) {
      return luaOp(
        op,
        singleResult(leftVal),
        singleResult(rightVal),
        ctx,
        sf,
        hints,
      );
    }
    return rpThen(rightVal, (rv) =>
      luaOp(
        op,
        singleResult(leftVal),
        singleResult(rv),
        ctx,
        sf,
        hints,
      ));
  }

  return rpThen(leftVal, (lv) => {
    const rightVal = evalExpression(rightExpr, env, sf);
    if (!isPromise(rightVal)) {
      return luaOp(
        op,
        singleResult(lv),
        singleResult(rightVal),
        ctx,
        sf,
        hints,
      );
    }
    return rpThen(rightVal, (rv) =>
      luaOp(
        op,
        singleResult(lv),
        singleResult(rv),
        ctx,
        sf,
        hints,
      ));
  });
}

// Relational comparison "prelude"
function luaRelOperands(
  a: any,
  b: any,
): {
  ta: string;
  tb: string;
  av: any;
  bv: any;
} {
  const ta = luaTypeName(a);
  const tb = luaTypeName(b);
  const av = (a instanceof Number) ? Number(a) : a;
  const bv = (b instanceof Number) ? Number(b) : b;

  return { ta, tb, av, bv };
}

// Simplified operator definitions
const operatorsMetaMethods: Record<string, {
  metaMethod?: string;
  nativeImplementation: (
    a: LuaValue,
    b: LuaValue,
    ctx: ASTCtx,
    sf: LuaStackFrame,
    hints?: OpHints,
  ) => LuaValue;
}> = {
  "+": {
    metaMethod: "__add",
    nativeImplementation: (a, b, _ctx, _sf, hints) => {
      const { ax, bx, bothInt } = coerceNumericPair(a, b, hints);
      return normalizeArithmeticResult(ax + bx, bothInt);
    },
  },
  "-": {
    metaMethod: "__sub",
    nativeImplementation: (a, b, _ctx, _sf, hints) => {
      const { ax, bx, bothInt } = coerceNumericPair(a, b, hints);
      return normalizeArithmeticResult(ax - bx, bothInt);
    },
  },
  "*": {
    metaMethod: "__mul",
    nativeImplementation: (a, b, _ctx, _sf, hints) => {
      const { ax, bx, bothInt } = coerceNumericPair(a, b, hints);
      return normalizeArithmeticResult(ax * bx, bothInt);
    },
  },
  "/": {
    metaMethod: "__div",
    nativeImplementation: (a, b, _ctx, _sf, hints) => {
      const { ax, bx, bothInt, bZeroKind } = coerceNumericPair(a, b, hints);

      // In integer division mode, or if divisor is an integer zero,
      // normalize -0 to +0.
      let divisor = bx;
      if ((bothInt || bZeroKind === "int") && isNegativeZero(bx)) {
        divisor = 0;
      }

      const result = ax / divisor;
      return normalizeArithmeticResult(result, false);
    },
  },
  "//": {
    metaMethod: "__idiv",
    nativeImplementation: (a, b, ctx, sf, hints) =>
      luaFloorDiv(a, b, ctx, sf, hints),
  },
  "%": {
    metaMethod: "__mod",
    nativeImplementation: (a, b, ctx, sf, hints) =>
      luaMod(a, b, ctx, sf, hints),
  },
  "^": {
    metaMethod: "__pow",
    nativeImplementation: (a, b, _ctx, _sf, hints) => {
      const { ax, bx } = coerceNumericPair(a, b, hints);
      const result = ax ** bx;

      // Always treat as potentially float
      return normalizeArithmeticResult(result, false);
    },
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
    nativeImplementation: (a, b, ctx, sf) => {
      const coerce = (v: any): string => {
        if (v === null || v === undefined) {
          throw new LuaRuntimeError(
            "attempt to concatenate a nil value",
            sf.withCtx(ctx),
          );
        }
        if (typeof v === "string") {
          return v as string;
        }
        if (typeof v === "number" || v instanceof Number) {
          return String(v instanceof Number ? Number(v) : v);
        }
        const t = luaTypeName(v);
        throw new LuaRuntimeError(
          `attempt to concatenate a ${t} value`,
          sf.withCtx(ctx),
        );
      };
      return coerce(a) + coerce(b);
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
    nativeImplementation: (a, b, ctx, sf) => luaLess(a, b, ctx, sf),
  },
  "<=": {
    metaMethod: "__le",
    nativeImplementation: (a, b, ctx, sf) => luaLessEqual(a, b, ctx, sf),
  },
  // Lua does not define `>`/`>=` as logical negations of `<`/`<=` but
  // as swapped operands (`a>b` evaluated as `b<a`, `a>=b` as `b<=a`).
  ">": {
    nativeImplementation: (a, b, ctx, sf) => luaOp("<", b, a, ctx, sf),
  },
  ">=": {
    nativeImplementation: (a, b, ctx, sf) => luaOp("<=", b, a, ctx, sf),
  },
};

function luaOp(
  op: string,
  left: any,
  right: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
  hints?: OpHints,
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

  try {
    return handler.nativeImplementation(left, right, ctx, sf, hints);
  } catch (e: any) {
    // If numeric coercion failed on a string produce the Lua message
    if (e === luaStringCoercionError) {
      const mapped = maybeLuaArithStringError(op, left, right, ctx, sf);
      if (mapped) {
        throw mapped;
      }
      // Fallback
      throw new LuaRuntimeError(
        "attempt to perform arithmetic on a string value",
        sf.withCtx(ctx),
      );
    }

    const mapped = maybeLuaArithStringError(op, left, right, ctx, sf);
    if (mapped) {
      throw mapped;
    }
    throw e;
  }
}

/**
 * Length operator:
 * - for strings return byte length, ignore `__len`,
 * - for Lua tables if metatable has `__len` metamethod then call it;
 *   use table length otherwise,
 * - for other values (userdata): honor `__len` if present,
 * - for JavaScript arrays return length,
 * - throw error otherwise.
 */
function luaLengthOp(
  val: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaValue {
  // Strings: ignore `__len`
  if (typeof val === "string") {
    return val.length;
  }

  // Tables: prefer metatable `__len` to raw length
  if (val instanceof LuaTable) {
    const mt = getMetatable(val, sf);
    if (mt && mt.has("__len")) {
      const fn = mt.get("__len");
      return luaCall(fn, [val], ctx, sf);
    }
    return val.length;
  }

  // Other values: allow metatable `__len` first
  {
    const mt = getMetatable(val, sf);
    if (mt && mt.has("__len")) {
      const fn = mt.get("__len");
      return luaCall(fn, [val], ctx, sf);
    }
  }

  // JS arrays (interop): length if no `__len` override
  if (Array.isArray(val)) {
    return val.length;
  }

  // Otherwise error with type
  const t = luaTypeOf(val) as LuaType;
  throw new LuaRuntimeError(
    `attempt to get length of a ${t} value`,
    sf.withCtx(ctx),
  );
}

function evalExpressions(
  es: LuaExpression[],
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaValue[]> | LuaValue[] {
  // Evaluate all arguments first (sync-first); do not allocate a Promise if all are sync.
  const parts = es.map((arg) => evalExpression(arg, env, sf));
  const argsVal = rpAll(parts);

  // In Lua multi-returns propagate only in tail position of an expression
  // list.
  const finalize = (argsResolved: any[]) => {
    if (argsResolved.length === 0) {
      return [];
    }
    const out: LuaValue[] = [];
    // All but last expression produce a single value
    for (let i = 0; i < argsResolved.length - 1; i++) {
      out.push(singleResult(argsResolved[i]));
    }
    // Last expression preserves multiple results
    const last = argsResolved[argsResolved.length - 1];
    if (last instanceof LuaMultiRes) {
      out.push(...last.flatten().values);
    } else {
      out.push(singleResult(last));
    }
    return out;
  };

  return rpThen(argsVal, finalize);
}

type EvalBlockResult =
  | void
  | ControlSignal
  | Promise<void | ControlSignal>;

function runStatementsNoGoto(
  stmts: LuaStatement[],
  execEnv: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn: boolean,
  startIdx: number,
): void | ControlSignal | Promise<void | ControlSignal> {
  const processFrom = (
    idx: number,
  ): void | ControlSignal | Promise<void | ControlSignal> => {
    for (let i = idx; i < stmts.length; i++) {
      const result = evalStatement(
        stmts[i],
        execEnv,
        sf,
        returnOnReturn,
      );
      if (isPromise(result)) {
        return (result as Promise<any>).then((res) => {
          if (res !== undefined) {
            if (isGotoSignal(res)) {
              throw new LuaRuntimeError(
                "unexpected goto signal",
                sf.withCtx(stmts[i].ctx),
              );
            }
            return res;
          }
          return processFrom(i + 1);
        });
      }
      if (result !== undefined) {
        if (isGotoSignal(result)) {
          throw new LuaRuntimeError(
            "unexpected goto signal",
            sf.withCtx(stmts[i].ctx),
          );
        }
        return result;
      }
    }
    return;
  };

  return processFrom(startIdx);
}

function withCloseBoundary(
  sf: LuaStackFrame,
  mark: number,
  out: EvalBlockResult,
): EvalBlockResult {
  if (!isPromise(out)) {
    const r = luaCloseFromMark(sf, mark, null);
    if (isPromise(r)) {
      return (r as Promise<void>).then(() => out as any);
    }
    return out;
  }

  const p = out as Promise<any>;

  const onFulfilled = (res: any) => {
    const r = luaCloseFromMark(sf, mark, null);
    return isPromise(r) ? (r as Promise<void>).then(() => res) : res;
  };

  const onRejected = (e: any) => {
    const errObj: LuaValue = e instanceof LuaRuntimeError
      ? e.message
      : (e?.message ?? String(e));
    const r = luaCloseFromMark(sf, mark, errObj);
    if (isPromise(r)) {
      return (r as Promise<void>).then(() => {
        throw e;
      });
    }
    throw e;
  };

  return p.then(onFulfilled, onRejected);
}

function evalBlockNoClose(
  b: LuaBlock,
  env: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn: boolean,
): EvalBlockResult {
  const hasGotoFlag = b.hasGoto === true;
  const hasLabelFlag = b.hasLabel === true;
  const hasLabelHere = b.hasLabelHere === true;

  const curFn = sf.currentFunction;
  const fnHasGotos = curFn?.funcHasGotos;

  if (fnHasGotos === false || (!hasGotoFlag && !hasLabelFlag)) {
    const dup = b.dupLabelError;
    if (dup) {
      // Duplicated labels detected by parser.
      throw new LuaRuntimeError(
        `label '${dup.name}' already defined`,
        sf.withCtx(dup.ctx),
      );
    }

    const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
    return runStatementsNoGoto(b.statements, execEnv, sf, returnOnReturn, 0);
  }

  if (fnHasGotos === true && !hasLabelHere && !hasGotoFlag) {
    const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
    const stmts = b.statements;
    const runFrom = (
      i: number,
    ): EvalBlockResult => {
      for (; i < stmts.length; i++) {
        const r = evalStatement(stmts[i], execEnv, sf, returnOnReturn);
        if (isPromise(r)) {
          return (r as Promise<any>).then((res) => {
            if (isGotoSignal(res)) return res;
            if (res !== undefined) return res;
            return runFrom(i + 1);
          });
        } else {
          if (isGotoSignal(r)) return r;
          if (r !== undefined) return r;
        }
      }
      return;
    };
    return runFrom(0);
  }

  let meta: ReturnType<typeof getBlockGotoMeta> | undefined;
  if (fnHasGotos === undefined && (hasGotoFlag || hasLabelFlag)) {
    meta = blockMetaOrThrow(b, sf);
    if (curFn) {
      curFn.funcHasGotos = !!meta?.funcHasGotos;
    }
  } else if (fnHasGotos === true) {
    meta = hasLabelFlag || hasGotoFlag ? blockMetaOrThrow(b, sf) : undefined;
  } else {
    meta = undefined;
  }

  if (!meta || !meta.funcHasGotos) {
    const dup = b.dupLabelError;
    if (dup) {
      throw new LuaRuntimeError(
        `label '${dup.name}' already defined`,
        sf.withCtx(dup.ctx),
      );
    }
    const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
    return runStatementsNoGoto(b.statements, execEnv, sf, returnOnReturn, 0);
  }

  const execEnv = b.needsEnv === true ? new LuaEnv(env) : env;
  const stmts = b.statements;

  const runFrom = (
    i: number,
  ): EvalBlockResult => {
    for (; i < stmts.length; i++) {
      const r = evalStatement(stmts[i], execEnv, sf, returnOnReturn);
      if (isPromise(r)) {
        return (r as Promise<any>).then((res) => {
          const consumed = consumeGotoInBlock(res, meta!.labels);
          if (typeof consumed === "number") {
            return runFrom(consumed);
          }
          if (consumed !== undefined) {
            return consumed;
          }
          return runFrom(i + 1);
        });
      }
      const consumed = consumeGotoInBlock(r, meta.labels);
      if (typeof consumed === "number") {
        i = consumed - 1;
        continue;
      }
      if (consumed !== undefined) {
        return consumed;
      }
    }
    return;
  };

  return runFrom(0);
}

/**
 * Evaluates a statement in two possible modes:
 *
 * 1. With `returnOnReturn` set to `true` will return the value of
 *    a return statement.
 * 2. With `returnOnReturn` set to `false` will throw a LuaReturn
 *    exception if a return statement is encountered.
 *
 * May also return `{ctrl:"goto", target}` for goto.
 */
export function evalStatement(
  s: LuaStatement,
  env: LuaEnv,
  sf: LuaStackFrame,
  returnOnReturn = false,
): void | ControlSignal | Promise<void | ControlSignal> {
  switch (s.type) {
    case "Assignment": {
      const a = asAssignment(s);
      const valuesRP = evalExpressions(a.expressions, env, sf);
      const lvaluesRP = evalPromiseValues(a.variables
        .map((lval) => evalLValue(lval, env, sf)));

      const apply = (values: LuaValue[], lvalues: { env: any; key: any }[]) => {
        const ps: Promise<any>[] = [];
        for (let i = 0; i < lvalues.length; i++) {
          const r = luaSet(
            lvalues[i].env,
            lvalues[i].key,
            values[i],
            sf.withCtx(a.ctx),
          );
          if (isPromise(r)) {
            ps.push(r);
          }
        }
        if (ps.length) {
          return Promise.all(ps).then(() => undefined);
        }
        return;
      };

      if (!isPromise(valuesRP) && !isPromise(lvaluesRP)) {
        return apply(
          valuesRP as LuaValue[],
          lvaluesRP as LuaLValueContainer[],
        );
      } else if (
        isPromise(valuesRP) && !isPromise(lvaluesRP)
      ) {
        return (valuesRP as Promise<LuaValue[]>).then((values: LuaValue[]) =>
          apply(values, lvaluesRP as LuaLValueContainer[])
        );
      } else if (
        !isPromise(valuesRP) && isPromise(lvaluesRP)
      ) {
        return (lvaluesRP as Promise<any[]>).then((lvalues: any[]) =>
          apply(valuesRP as LuaValue[], lvalues)
        );
      } else {
        return (valuesRP as Promise<LuaValue[]>).then((values: LuaValue[]) =>
          (lvaluesRP as Promise<any[]>).then((lvalues: any[]) =>
            apply(values, lvalues)
          )
        );
      }
    }
    case "Local": {
      const l = asLocal(s);

      const hasInit = Array.isArray(l.expressions) && l.expressions.length > 0;

      for (const att of l.names) {
        const isConst = att.attributes?.includes(LuaAttribute.Const) === true;
        if (isConst && !hasInit) {
          throw new LuaRuntimeError(
            `const variable '${att.name}' must be initialized`,
            sf.withCtx(att.ctx),
          );
        }
      }

      const bindOne = (name: any, v: LuaValue) => {
        const isConst = name.attributes?.includes(LuaAttribute.Const) === true;
        const isClose = name.attributes?.includes(LuaAttribute.Close) === true;

        if (isConst || isClose) {
          env.setLocalConst(name.name, v);
        } else {
          env.setLocal(name.name, v);
        }

        if (isClose) {
          luaMarkToBeClosed(sf, v, name.ctx);
        }
      };

      if (!hasInit) {
        for (let i = 0; i < l.names.length; i++) {
          bindOne(l.names[i], null);
        }
        return;
      }

      // Evaluate initializers left-to-right and bind/mark `<close>`
      // locals as soon as they receive a value.  This ensures earlier
      // `<close>` locals are closed if a later initializer errors.
      const exprs = l.expressions!;
      const out: LuaValue[] = [];
      let boundCount = 0;

      const bindAvailable = () => {
        while (boundCount < l.names.length && boundCount < out.length) {
          bindOne(l.names[boundCount], out[boundCount] ?? null);
          boundCount++;
        }
      };

      const finish = () => {
        while (out.length < l.names.length) {
          out.push(null);
        }
        bindAvailable();
      };

      const runFrom = (i: number): void | Promise<void> => {
        if (i >= exprs.length) {
          finish();
          return;
        }

        const isLastExpr = i === exprs.length - 1;
        const rp = evalExpression(exprs[i], env, sf);

        const onValue = (v: LuaValue) => {
          if (isLastExpr) {
            if (v instanceof LuaMultiRes) {
              for (const x of v.values) {
                out.push(x);
              }
            } else {
              out.push(v);
            }
          } else {
            out.push(singleResult(v));
          }

          bindAvailable();

          // If we already have enough values for all locals, remaining
          // expressions will not affect the binding, so we can stop.
          if (out.length >= l.names.length && !isLastExpr) {
            return;
          }

          return runFrom(i + 1);
        };

        return rpThen(rp, onValue) as any;
      };

      return runFrom(0);
    }
    case "Semicolon": {
      return;
    }
    case "Label": {
      const _lab = asLabel(s); // No-op!
      return;
    }
    case "Goto": {
      const g = asGoto(s);
      return { ctrl: "goto", target: g.name };
    }
    case "Block": {
      const b = asBlock(s);

      if (!b.hasCloseHere) {
        return evalBlockNoClose(b, env, sf, returnOnReturn);
      }

      // Blocks establish a boundary (mark) and close all entries
      // created within the block on exit or error, shrinking the stack
      // back to mark.  This is _required_ for correct `pcall` and
      // `xpcall` boundary semantics.
      const closeStack = luaEnsureCloseStack(sf);
      const mark = closeStack.length;

      let out: EvalBlockResult;
      try {
        out = evalBlockNoClose(b, env, sf, returnOnReturn);
      } catch (e: any) {
        const errObj: LuaValue = e instanceof LuaRuntimeError
          ? e.message
          : (e?.message ?? String(e));
        const r = luaCloseFromMark(sf, mark, errObj);
        if (isPromise(r)) {
          return (r as Promise<void>).then(() => {
            throw e;
          });
        }
        throw e;
      }

      return withCloseBoundary(sf, mark, out);
    }
    case "If": {
      const iff = asIf(s);
      // Evaluate conditions in order; avoid awaiting when not necessary
      const conds = iff.conditions;

      const runFrom = (
        i: number,
      ):
        | void
        | ControlSignal
        | Promise<void | ControlSignal> => {
        if (i >= conds.length) {
          if (iff.elseBlock) {
            return evalStatement(iff.elseBlock, env, sf, returnOnReturn);
          }
          return;
        }
        const cv = evalExpression(conds[i].condition, env, sf);
        if (isPromise(cv)) {
          return (cv as Promise<any>).then((val) => {
            if (luaTruthy(val)) {
              return evalStatement(conds[i].block, env, sf, returnOnReturn);
            }
            return runFrom(i + 1);
          });
        } else {
          if (luaTruthy(cv)) {
            return evalStatement(conds[i].block, env, sf, returnOnReturn);
          }
          return runFrom(i + 1);
        }
      };

      return runFrom(0);
    }
    case "While": {
      const w = asWhile(s);

      const runAsync = async (): Promise<void | ControlSignal> => {
        while (true) {
          const c = await evalExpression(w.condition, env, sf);
          if (!luaTruthy(c)) {
            break;
          }
          const r = evalStatement(w.block, env, sf, returnOnReturn);
          const res = isPromise(r) ? await r : r;
          if (res !== undefined) {
            if (isBreakSignal(res)) {
              break;
            }
            return res;
          }
        }
        return;
      };

      while (true) {
        const c = evalExpression(w.condition, env, sf);
        if (isPromise(c)) {
          return (c as Promise<any>).then((cv) => {
            if (!luaTruthy(cv)) {
              return;
            }
            try {
              const r = evalStatement(w.block, env, sf, returnOnReturn);
              if (isPromise(r)) {
                return (r as Promise<any>).then((res) => {
                  if (res !== undefined) {
                    if (isBreakSignal(res)) {
                      return;
                    }
                    return res;
                  }
                  return runAsync();
                });
              } else {
                if (r !== undefined) {
                  if (isBreakSignal(r)) {
                    return;
                  }
                  return r;
                }
                return runAsync();
              }
            } catch (e: any) {
              throw e;
            }
          });
        }
        if (!luaTruthy(c)) {
          break;
        }
        const r = evalStatement(w.block, env, sf, returnOnReturn);
        if (isPromise(r)) {
          return (r as Promise<any>).then((res) => {
            if (res !== undefined) {
              if (isBreakSignal(res)) {
                return;
              }
              return res;
            }
            return runAsync();
          });
        } else {
          if (r !== undefined) {
            if (isBreakSignal(r)) {
              break;
            }
            return r;
          }
        }
      }
      return;
    }
    case "Repeat": {
      const r = asRepeat(s);

      const runAsync = async (): Promise<void | ControlSignal> => {
        while (true) {
          const rr = evalStatement(r.block, env, sf, returnOnReturn);
          const res = isPromise(rr) ? await rr : rr;
          if (res !== undefined) {
            if (isBreakSignal(res)) {
              break;
            }
            return res;
          }
          const c = await evalExpression(r.condition, env, sf);
          if (luaTruthy(c)) {
            break;
          }
        }
        return;
      };

      while (true) {
        const rr = evalStatement(r.block, env, sf, returnOnReturn);
        if (isPromise(rr)) {
          return (rr as Promise<any>).then((res) => {
            if (res !== undefined) {
              if (isBreakSignal(res)) {
                return;
              }
              return res;
            }
            return runAsync();
          });
        } else {
          if (rr !== undefined) {
            if (isBreakSignal(rr)) {
              return;
            }
            return rr;
          }
        }

        const c = evalExpression(r.condition, env, sf);
        if (isPromise(c)) {
          return (c as Promise<any>).then((cv) =>
            luaTruthy(cv) ? undefined : runAsync()
          );
        } else {
          if (luaTruthy(c)) {
            break;
          }
        }
      }
      return;
    }
    case "Break": {
      return { ctrl: "break" };
    }
    case "FunctionCallStatement": {
      const fcs = asFunctionCallStmt(s);
      const r = evalExpression(fcs.call, env, sf);
      if (isPromise(r)) {
        return (r as Promise<any>).then(() => undefined);
      }
      return;
    }
    case "Function": {
      const fn = asFunctionStmt(s);
      let body = fn.body;
      let propNames = fn.name.propNames;
      if (fn.name.colonName) {
        // function hello:there() -> function hello.there(self) transformation
        body = {
          ...(fn.body),
          parameters: ["self", ...fn.body.parameters],
        };
        propNames = [...fn.name.propNames, fn.name.colonName];
      }
      let settable: ILuaSettable & ILuaGettable = env;
      for (let i = 0; i < propNames.length - 1; i++) {
        settable = (settable as any).get(propNames[i]);
        if (!settable) {
          throw new LuaRuntimeError(
            `Cannot find property ${propNames[i]}`,
            sf.withCtx(fn.name.ctx),
          );
        }
      }
      (settable as any).set(
        propNames[propNames.length - 1],
        new LuaFunction(body, env),
      );
      return;
    }
    case "LocalFunction": {
      const lf = asLocalFunction(s);
      env.setLocal(
        lf.name,
        new LuaFunction(lf.body, env),
      );
      return;
    }
    case "Return": {
      const ret = asReturn(s);
      // Sync-first collection of return expressions, no extra Promise
      // if all are sync.
      const parts = ret.expressions.map((value: LuaExpression) =>
        evalExpression(value, env, sf)
      );
      const valuesRP = rpAll(parts);

      if (isPromise(valuesRP)) {
        return (valuesRP as Promise<any[]>).then((vals) => ({
          ctrl: "return",
          values: vals as LuaValue[],
        }));
      } else {
        return {
          ctrl: "return",
          values: valuesRP as LuaValue[],
        };
      }
    }
    case "For": {
      const fr = asFor(s);
      const startV = evalExpression(fr.start, env, sf);
      const endV = evalExpression(fr.end, env, sf);
      const stepV = fr.step ? evalExpression(fr.step, env, sf) : 1;

      const classifyMode = (
        start: any,
        _end: any,
        step: any,
      ): "int" | "float" => {
        const s0 = untagNumber(start);
        const st0 = untagNumber(step);

        if (!Number.isInteger(s0) || !Number.isInteger(st0)) {
          return "float";
        }

        const startKind = getNumericKind(start);
        const stepKind = getNumericKind(step);

        if (startKind === "float" || stepKind === "float") {
          return "float";
        }

        return "int";
      };

      const wrapLoopVar = (i: number, mode: "int" | "float") => {
        if (mode === "float") {
          return floatLiteral(i);
        }
        return i;
      };

      const runAsync = async (
        _start: any,
        end: any,
        step: any,
        mode: "int" | "float",
        startIndex: number,
      ) => {
        const e0 = untagNumber(end);
        const st0 = untagNumber(step);

        if (st0 === 0) {
          throw new LuaRuntimeError("'for' step is zero", sf.withCtx(fr.ctx));
        }

        if (st0 > 0) {
          for (let i = startIndex; i <= e0; i += st0) {
            const localEnv = new LuaEnv(env);
            localEnv.setLocal(fr.name, wrapLoopVar(i, mode));
            const r = evalStatement(fr.block, localEnv, sf, returnOnReturn);
            const res = isPromise(r) ? await r : r;
            if (res !== undefined) {
              if (isBreakSignal(res)) {
                break;
              }
              return res;
            }
          }
        } else {
          for (let i = startIndex; i >= e0; i += st0) {
            const localEnv = new LuaEnv(env);
            localEnv.setLocal(fr.name, wrapLoopVar(i, mode));
            const r = evalStatement(fr.block, localEnv, sf, returnOnReturn);
            const res = isPromise(r) ? await r : r;
            if (res !== undefined) {
              if (isBreakSignal(res)) {
                break;
              }
              return res;
            }
          }
        }
        return;
      };

      const runSyncFirst = (
        start: any,
        end: any,
        step: any,
        mode: "int" | "float",
      ):
        | void
        | ControlSignal
        | Promise<void | ControlSignal> => {
        const s0 = untagNumber(start);
        const e0 = untagNumber(end);
        const st0 = untagNumber(step);

        if (st0 === 0) {
          throw new LuaRuntimeError("'for' step is zero", sf.withCtx(fr.ctx));
        }

        if (st0 > 0) {
          for (let i = s0; i <= e0; i += st0) {
            const localEnv = new LuaEnv(env);
            localEnv.setLocal(fr.name, wrapLoopVar(i, mode));
            const r = evalStatement(fr.block, localEnv, sf, returnOnReturn);
            if (isPromise(r)) {
              return (r as Promise<any>).then((res) => {
                if (res !== undefined) {
                  if (isBreakSignal(res)) {
                    return;
                  }
                  return res;
                }
                return runAsync(start, end, step, mode, i + st0);
              });
            } else if (r !== undefined) {
              if (isBreakSignal(r)) {
                break;
              }
              return r;
            }
          }
        } else {
          for (let i = s0; i >= e0; i += st0) {
            const localEnv = new LuaEnv(env);
            localEnv.setLocal(fr.name, wrapLoopVar(i, mode));
            const r = evalStatement(fr.block, localEnv, sf, returnOnReturn);
            if (isPromise(r)) {
              return (r as Promise<any>).then((res) => {
                if (res !== undefined) {
                  if (isBreakSignal(res)) {
                    return;
                  }
                  return res;
                }
                return runAsync(start, end, step, mode, i + st0);
              });
            } else if (r !== undefined) {
              if (isBreakSignal(r)) {
                break;
              }
              return r;
            }
          }
        }
        return;
      };
      if (
        !isPromise(startV) &&
        !isPromise(endV) &&
        !isPromise(stepV)
      ) {
        const mode = classifyMode(startV, endV, stepV);
        return runSyncFirst(startV, endV, stepV ?? 1, mode);
      } else {
        return Promise.all([
          isPromise(startV) ? startV : Promise.resolve(startV),
          isPromise(endV) ? endV : Promise.resolve(endV),
          isPromise(stepV) ? stepV : Promise.resolve(stepV),
        ]).then(([start, end, step]) => {
          const mode = classifyMode(start, end, step ?? 1);
          return runSyncFirst(start, end, step ?? 1, mode);
        });
      }
    }
    case "ForIn": {
      const fi = asForIn(s);
      const exprVals = rpAll(
        fi.expressions.map((e: LuaExpression) => evalExpression(e, env, sf)),
      );

      const afterExprs = (resolved: any[]) => {
        const iteratorMultiRes = new LuaMultiRes(resolved).flatten();
        let iteratorValue: ILuaFunction | any = iteratorMultiRes.values[0];
        // Handle the case where the iterator is a table and we need
        // to call the `each` function.
        if (Array.isArray(iteratorValue) || iteratorValue instanceof LuaTable) {
          iteratorValue = (env.get("each") as ILuaFunction).call(
            sf,
            iteratorValue,
          );
        }

        if (!iteratorValue?.call) {
          console.error("Cannot iterate over", iteratorMultiRes.values[0]);
          throw new LuaRuntimeError(
            `Cannot iterate over ${iteratorMultiRes.values[0]}`,
            sf.withCtx(fi.ctx),
          );
        }

        const state: LuaValue = iteratorMultiRes.values[1] ?? null;
        let control: LuaValue = iteratorMultiRes.values[2] ?? null;
        const closing: LuaValue = iteratorMultiRes.values[3] ?? null;

        // The closing value in a generic-for has loop scope.  Close it
        // when the loop ends, not only when the surrounding block ends.
        const closeStack = luaEnsureCloseStack(sf);
        const mark = closeStack.length;

        // The closing value is a "to-be-closed" value, and only `nil`
        // means "no close"; `false` is NOT special here.
        if (closing !== null) {
          luaMarkToBeClosed(sf, closing, fi.ctx);
        }

        const errObjFrom = (e: any): LuaValue =>
          e instanceof LuaRuntimeError ? e.message : (e?.message ?? String(e));

        const finish = (res: any) => {
          const r = luaCloseFromMark(sf, mark, null);
          return isPromise(r) ? (r as Promise<void>).then(() => res) : res;
        };

        const finishErr = (e: any): Promise<never> | never => {
          const errObj = errObjFrom(e);
          const r = luaCloseFromMark(sf, mark, errObj);
          if (isPromise(r)) {
            return (r as Promise<void>).then(() => {
              throw e;
            });
          }
          throw e;
        };

        try {
          const runAsync = async () => {
            while (true) {
              const callRes = luaCall(
                iteratorValue,
                [state, control],
                fi.ctx,
                sf,
              );
              const iterResult = new LuaMultiRes(
                isPromise(callRes) ? await callRes : callRes,
              ).flatten();
              const nextControl = iterResult.values[0];
              if (nextControl === null || nextControl === undefined) {
                break;
              }
              control = nextControl;

              const localEnv = new LuaEnv(env);
              for (let i = 0; i < fi.names.length; i++) {
                localEnv.setLocal(fi.names[i], iterResult.values[i]);
              }

              const r = evalStatement(fi.block, localEnv, sf, returnOnReturn);
              const res = isPromise(r) ? await r : r;
              if (res !== undefined) {
                if (isBreakSignal(res)) {
                  break;
                }
                return await finish(res);
              }
            }
            return await finish(undefined);
          };

          while (true) {
            const iterCall = luaCall(
              iteratorValue,
              [state, control],
              fi.ctx,
              sf,
            );
            if (isPromise(iterCall)) {
              return (iterCall as Promise<any>).then((itv) => {
                const iterResult = new LuaMultiRes(itv).flatten();
                const nextControl = iterResult.values[0];
                if (nextControl === null || nextControl === undefined) {
                  const r = finish(undefined);
                  if (isPromise(r)) return (r as Promise<void>).then(() => {});
                  return;
                }
                control = nextControl;

                const localEnv = new LuaEnv(env);
                for (let i = 0; i < fi.names.length; i++) {
                  localEnv.setLocal(fi.names[i], iterResult.values[i]);
                }

                const r = evalStatement(
                  fi.block,
                  localEnv,
                  sf,
                  returnOnReturn,
                );
                if (isPromise(r)) {
                  return (r as Promise<any>).then((res) => {
                    if (res !== undefined) {
                      if (isBreakSignal(res)) {
                        return finish(undefined);
                      }
                      return rpThen(finish(undefined), () => res);
                    }
                    return runAsync();
                  });
                } else {
                  if (r !== undefined) {
                    if (isBreakSignal(r)) {
                      return finish(undefined);
                    }
                    return rpThen(finish(undefined), () => r);
                  }
                  return runAsync();
                }
              }).catch((e: any) => finishErr(e));
            }

            const iterResult = new LuaMultiRes(iterCall).flatten();
            const nextControl = iterResult.values[0];
            if (nextControl === null || nextControl === undefined) {
              const r = finish(undefined);
              if (isPromise(r)) {
                return (r as Promise<void>);
              }
              return;
            }
            control = nextControl;

            const localEnv = new LuaEnv(env);
            for (let i = 0; i < fi.names.length; i++) {
              localEnv.setLocal(fi.names[i], iterResult.values[i]);
            }

            const r = evalStatement(fi.block, localEnv, sf, returnOnReturn);
            if (isPromise(r)) {
              return (r as Promise<any>).then((res) => {
                if (res !== undefined) {
                  if (isBreakSignal(res)) {
                    return finish(undefined);
                  }
                  return rpThen(finish(undefined), () => res);
                }
                return runAsync();
              }).catch((e: any) => finishErr(e));
            } else if (r !== undefined) {
              if (isBreakSignal(r)) {
                return finish(undefined);
              }
              return rpThen(finish(undefined), () => r);
            }
          }
        } catch (e: any) {
          return finishErr(e);
        }
      };

      if (isPromise(exprVals)) {
        return (exprVals as Promise<any[]>).then(afterExprs);
      } else {
        return afterExprs(exprVals as any[]);
      }
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
      const v = asLValueVariable(lval);
      return {
        env,
        key: v.name,
      };
    }
    case "TableAccess": {
      const ta = asLValueTableAccess(lval);
      const objValue = evalExpression(
        ta.object,
        env,
        sf,
      );
      const keyValue = evalExpression(ta.key, env, sf);
      if (
        isPromise(objValue) ||
        isPromise(keyValue)
      ) {
        return Promise.all([
          isPromise(objValue) ? objValue : Promise.resolve(objValue),
          isPromise(keyValue) ? keyValue : Promise.resolve(keyValue),
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
      const pa = asLValuePropertyAccess(lval);
      const objValue = evalExpression(
        pa.object,
        env,
        sf,
      );
      if (isPromise(objValue)) {
        return (objValue as Promise<any>).then((ov) => {
          return {
            env: ov,
            key: pa.property,
          };
        });
      } else {
        return {
          env: objValue,
          key: pa.property,
        };
      }
    }
  }
}

function exactInt(
  num: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): number {
  // See conversion from float to integer https://www.lua.org/manual/5.4/manual.html#3.4.3
  let n: number;
  if (typeof num === "number") {
    n = num;
  } else if (num instanceof Number) {
    n = Number(num);
  } else if (typeof num === "string") {
    throw new LuaRuntimeError(
      `attempt to perform bitwise operation on a string value (constant '${num}')`,
      sf.withCtx(ctx),
    );
  } else {
    const t = luaTypeName(num);
    throw new LuaRuntimeError(
      `attempt to perform bitwise operation on a ${t} value`,
      sf.withCtx(ctx),
    );
  }

  if (!Number.isInteger(n)) {
    throw new LuaRuntimeError(
      `number has no integer representation`,
      sf.withCtx(ctx),
    );
  }
  return n;
}
