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
  isILuaFunction,
  jsToLuaValue,
  luaCall,
  luaCloseFromMark,
  luaEnsureCloseStack,
  LuaEnv,
  luaEquals,
  luaFormatNumber,
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
  coerceNumericPair,
  coerceToNumber,
  inferNumericType,
  isNegativeZero,
  isTaggedFloat,
  luaStringCoercionError,
  makeLuaFloat,
  makeLuaZero,
  normalizeArithmeticResult,
  toInteger,
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

const astNumberKindCache = new WeakMap<LuaExpression, NumericType>();

function astNumberKind(e: LuaExpression | undefined): NumericType | undefined {
  if (!e) return undefined;

  const cached = astNumberKindCache.get(e);
  if (cached) return cached;

  let unwrapped = e;
  while (unwrapped.type === "Parenthesized") {
    unwrapped = unwrapped.expression;
  }

  let result: NumericType | undefined;

  if (unwrapped.type === "Unary" && unwrapped.operator === "-") {
    result = astNumberKind(unwrapped.argument);
  } else if (unwrapped.type === "Number") {
    result = unwrapped.numericType === "int" ? "int" : "float";
  } else if (unwrapped.type === "Binary") {
    const op = unwrapped.operator;
    const numericOp = op === "+" || op === "-" || op === "*" || op === "/" ||
      op === "//" || op === "%" || op === "^";

    if (numericOp) {
      const lk = astNumberKind(unwrapped.left);
      const rk = astNumberKind(unwrapped.right);

      if (lk === "float" || rk === "float") {
        result = "float";
      } else if (lk === "int" && rk === "int") {
        result = "int";
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  if (result !== undefined) {
    astNumberKindCache.set(e, result);
  }

  return result;
}

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

function isNumericBinaryOp(op: string): boolean {
  return (
    op === "+" ||
    op === "-" ||
    op === "*" ||
    op === "/" ||
    op === "//" ||
    op === "%" ||
    op === "^"
  );
}

function arithCoercionErrorOrThrow(
  op: string,
  left: any,
  right: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
  e: any,
): never {
  if (e === luaStringCoercionError) {
    const mapped = maybeLuaArithStringError(op, left, right, ctx, sf);
    if (mapped) {
      throw mapped;
    }
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

export function luaOp(
  op: string,
  left: any,
  right: any,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  switch (op) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "^": {
      const ar = numericArith[op as NumericArithOp];
      try {
        const { left: l, right: r, resultType } = coerceNumericPair(
          left,
          right,
          leftType,
          rightType,
          op,
        );

        let result = ar.f(l, r);

        if (
          ar.special === "sub" &&
          result === 0 &&
          isNegativeZero(result) &&
          resultType === "float"
        ) {
          const rhsIsIntZero = r === 0 && rightType === "int";
          if (rhsIsIntZero) {
            result = 0;
          }
        }

        const normalized = normalizeArithmeticResult(result, resultType);

        // Operators `/` and `^` produce float, wrap only if needed.
        if (op === "/" || op === "^") {
          if (normalized === 0) {
            return makeLuaZero(normalized, "float");
          }
          if (!Number.isFinite(normalized)) {
            return normalized;
          }
          if (!Number.isInteger(normalized)) {
            return normalized;
          }
          return makeLuaFloat(normalized);
        }

        if (normalized === 0) {
          return makeLuaZero(normalized, resultType);
        }
        if (resultType === "float" && Number.isInteger(normalized)) {
          return makeLuaFloat(normalized);
        }
        return normalized;
      } catch (e: any) {
        const meta = evalMetamethod(left, right, ar.metaMethod, ctx, sf);
        if (meta !== undefined) {
          return meta;
        }
        return arithCoercionErrorOrThrow(op, left, right, ctx, sf, e);
      }
    }
    case "..": {
      try {
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
          if (typeof v === "number") {
            return luaFormatNumber(v);
          }
          if (isTaggedFloat(v)) {
            return luaFormatNumber(v.value, "float");
          }
          const t = luaTypeName(v);
          throw new LuaRuntimeError(
            `attempt to concatenate a ${t} value`,
            sf.withCtx(ctx),
          );
        };
        return coerce(left) + coerce(right);
      } catch (e: any) {
        const meta = evalMetamethod(left, right, "__concat", ctx, sf);
        if (meta !== undefined) {
          return meta;
        }
        throw e;
      }
    }
    case "==": {
      if (luaEquals(left, right)) return true;
      return luaEqWithMetamethod(left, right, ctx, sf);
    }
    case "~=":
    case "!=": {
      if (luaEquals(left, right)) {
        return false;
      }
      return !luaEqWithMetamethod(left, right, ctx, sf);
    }
    case "<": {
      return luaRelWithMetamethod("<", left, right, ctx, sf);
    }
    case "<=": {
      return luaRelWithMetamethod("<=", left, right, ctx, sf);
    }
    // Lua: `a>b` is `b<a`, `a>=b` is `b<=a`
    case ">": {
      return luaRelWithMetamethod("<", right, left, ctx, sf);
    }
    case ">=": {
      return luaRelWithMetamethod("<=", right, left, ctx, sf);
    }
  }

  // Remaining operators: //, %, bitwise
  const handler = operatorsMetaMethods[op];
  if (!handler) {
    throw new LuaRuntimeError(`Unknown operator ${op}`, sf.withCtx(ctx));
  }

  try {
    return handler.nativeImplementation(
      left,
      right,
      leftType,
      rightType,
      ctx,
      sf,
    );
  } catch (e: any) {
    if (handler.metaMethod) {
      const meta = evalMetamethod(left, right, handler.metaMethod, ctx, sf);
      if (meta !== undefined) {
        return meta;
      }
    }
    return arithCoercionErrorOrThrow(op, left, right, ctx, sf, e);
  }
}

type NumericArithOp = "+" | "-" | "*" | "/" | "^";

const numericArith: Record<NumericArithOp, {
  metaMethod: "__add" | "__sub" | "__mul" | "__div" | "__pow";
  f: (l: number, r: number) => number;
  special?: "sub";
}> = {
  "+": { metaMethod: "__add", f: (l, r) => l + r },
  "-": { metaMethod: "__sub", f: (l, r) => l - r, special: "sub" },
  "*": { metaMethod: "__mul", f: (l, r) => l * r },
  "/": { metaMethod: "__div", f: (l, r) => l / r },
  "^": { metaMethod: "__pow", f: (l, r) => l ** r },
};

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

function luaFloorDiv(
  a: unknown,
  b: unknown,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  const { left, right, resultType } = coerceNumericPair(
    a,
    b,
    leftType,
    rightType,
    "//",
  );

  if (resultType === "int" && right === 0) {
    throw new LuaRuntimeError(
      `attempt to divide by zero`,
      sf.withCtx(ctx),
    );
  }

  const result = Math.floor(left / right);
  const normalized = normalizeArithmeticResult(result, resultType);
  if (normalized === 0) {
    return makeLuaZero(normalized, resultType);
  }
  if (resultType === "float" && Number.isInteger(normalized)) {
    return makeLuaFloat(normalized);
  }
  return normalized;
}

function luaMod(
  a: unknown,
  b: unknown,
  leftType: NumericType | undefined,
  rightType: NumericType | undefined,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): any {
  const { left, right, resultType } = coerceNumericPair(
    a,
    b,
    leftType,
    rightType,
    "%",
  );

  if (resultType === "int" && right === 0) {
    throw new LuaRuntimeError(
      `attempt to perform 'n%0'`,
      sf.withCtx(ctx),
    );
  }

  const q = Math.floor(left / right);
  const result = left - q * right;

  // Preserve -0.0 from left operand in float mode
  if (result === 0 && resultType === "float" && isNegativeZero(left)) {
    return makeLuaZero(-0, "float");
  }

  const normalized = normalizeArithmeticResult(result, resultType);
  if (normalized === 0) {
    return makeLuaZero(normalized, resultType);
  }
  if (resultType === "float" && Number.isInteger(normalized)) {
    return makeLuaFloat(normalized);
  }
  return normalized;
}

function luaUnaryMinus(
  v: number,
  numType: NumericType | undefined,
): number {
  const vType = numType ?? inferNumericType(v);

  if (v === 0 && vType === "int") {
    return 0;
  }

  if (v === 0 && vType === "float") {
    return isNegativeZero(v) ? 0 : -0;
  }

  return -v;
}

const operatorsMetaMethods: Record<string, {
  metaMethod?: string;
  nativeImplementation: (
    a: LuaValue,
    b: LuaValue,
    leftType: NumericType | undefined,
    rightType: NumericType | undefined,
    ctx: ASTCtx,
    sf: LuaStackFrame,
  ) => LuaValue;
}> = {
  "//": {
    metaMethod: "__idiv",
    nativeImplementation: (a, b, lt, rt, ctx, sf) =>
      luaFloorDiv(a, b, lt, rt, ctx, sf),
  },
  "%": {
    metaMethod: "__mod",
    nativeImplementation: (a, b, lt, rt, ctx, sf) =>
      luaMod(a, b, lt, rt, ctx, sf),
  },
  "&": {
    metaMethod: "__band",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt & bInt;
    },
  },
  "|": {
    metaMethod: "__bor",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt | bInt;
    },
  },
  "~": {
    metaMethod: "__bxor",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt ^ bInt;
    },
  },
  "<<": {
    metaMethod: "__shl",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt << bInt;
    },
  },
  ">>": {
    metaMethod: "__shr",
    nativeImplementation: (a, b, _lt, _rt, ctx, sf) => {
      const aInt = toInteger(a);
      const bInt = toInteger(b);
      if (aInt === null) throw createBitwiseError(a, ctx, sf);
      if (bInt === null) throw createBitwiseError(b, ctx, sf);
      return aInt >> bInt;
    },
  },
};

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
        if (e.value === 0) {
          return makeLuaZero(e.value, e.numericType);
        }
        if (e.numericType === "float" && Number.isInteger(e.value)) {
          return makeLuaFloat(e.value);
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
          return evalLogical("or", b.left, b.right, env, sf);
        }
        if (b.operator === "and") {
          return evalLogical("and", b.left, b.right, env, sf);
        }
        return evalBinaryWithLR(
          b.operator,
          b.left,
          b.right,
          b.ctx,
          env,
          sf,
        );
      }
      case "Unary": {
        const u = asUnary(e);

        // Fast path: negation of numeric literal
        if (u.operator === "-" && u.argument.type === "Number") {
          const num = u.argument;
          if (num.value === 0) {
            const z = num.numericType === "int" ? 0 : -0;
            return makeLuaZero(z, num.numericType);
          }
          if (num.numericType === "float" && Number.isInteger(num.value)) {
            return makeLuaFloat(-num.value);
          }
          return -num.value;
        }

        if (u.operator === "-") {
          const tv = evalExprWithNumericType(u.argument, env, sf, true);

          const applyTyped = (typed: TypedValue) => {
            const arg = singleResult(typed.value);

            return unaryWithMeta(
              arg,
              "__unm",
              u.ctx,
              sf,
              () => {
                // Numeric-string coercion for unary minus
                if (typeof arg === "string") {
                  const n = coerceToNumber(arg);
                  if (n === null) {
                    throw new LuaRuntimeError(
                      "attempt to unm a 'string' with a 'string'",
                      sf.withCtx(u.ctx),
                    );
                  }
                  if (n === 0) {
                    return 0;
                  }
                  return -n;
                }

                const plain = untagNumber(arg);
                if (typeof plain !== "number") {
                  throw new LuaRuntimeError(
                    "attempt to perform arithmetic on a table value",
                    sf.withCtx(u.ctx),
                  );
                }

                const argType = isTaggedFloat(arg)
                  ? "float"
                  : astNumberKind(u.argument);

                const out = luaUnaryMinus(plain, argType);

                // If the operand is a float-tagged boxed number, unary
                // minus must keep the result float-typed.
                if (isTaggedFloat(arg)) {
                  if (out === 0) {
                    return makeLuaZero(out, "float");
                  }
                  return makeLuaFloat(out);
                }

                // Preserve numeric kind for zero results
                if (out === 0) {
                  const outType = argType ?? inferNumericType(plain);
                  return makeLuaZero(out, outType);
                }

                return out;
              },
            );
          };

          return rpThen(tv as any, applyTyped);
        }

        const value = evalExpression(u.argument, env, sf);

        const applyUnary = (value: LuaValue) => {
          switch (u.operator) {
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
                () => {
                  const intVal = toInteger(arg);
                  if (intVal === null) {
                    if (typeof arg === "string") {
                      throw new LuaRuntimeError(
                        `attempt to perform bitwise operation on a string value (constant '${arg}')`,
                        sf.withCtx(u.ctx),
                      );
                    }
                    const t = luaTypeName(arg);
                    if (t === "number") {
                      throw new LuaRuntimeError(
                        `number has no integer representation`,
                        sf.withCtx(u.ctx),
                      );
                    }
                    throw new LuaRuntimeError(
                      `attempt to perform bitwise operation on a ${t} value`,
                      sf.withCtx(u.ctx),
                    );
                  }
                  return ~intVal;
                },
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

        return rpThen(value, applyUnary);
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
          // Expression fields assign consecutive integer keys starting
          // at 1 and advance even when the value is `nil`.
          let nextArrayIndex = 1;
          for (const field of tc.fields) {
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
                  const flat = value.flatten();
                  for (let i = 0; i < flat.values.length; i++) {
                    table.rawSetArrayIndex(nextArrayIndex, flat.values[i]);
                    nextArrayIndex++;
                  }
                } else {
                  table.rawSetArrayIndex(nextArrayIndex, singleResult(value));
                  nextArrayIndex++;
                }
                break;
              }
            }
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
                case "GroupBy": {
                  query.groupBy = clause.expressions;
                  break;
                }
                case "Having": {
                  query.having = clause.expression;
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
      }
      return value;
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
  if (leftMetatable) {
    const fn = leftMetatable.rawGet(metaMethod);
    if (!(fn === undefined || fn === null)) {
      return luaCall(fn, [left, right], ctx, sf);
    }
  }

  const rightMetatable = getMetatable(right, sf);
  if (rightMetatable) {
    const fn = rightMetatable.rawGet(metaMethod);
    if (!(fn === undefined || fn === null)) {
      return luaCall(fn, [left, right], ctx, sf);
    }
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
  if (!mt) {
    return undefined;
  }
  const fn = mt.rawGet(metaMethod);
  if (fn === undefined || fn === null) {
    return undefined;
  }
  return luaCall(fn, [value], ctx, sf);
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
    }
    if (!luaTruthy(lv)) {
      return singleResult(lv);
    }
    const rv = evalExpression(rightExpr, env, sf);
    return isPromise(rv)
      ? (rv as Promise<any>).then(singleResult)
      : singleResult(rv);
  };

  if (isPromise(left)) {
    return (left as Promise<any>).then(decide);
  }
  return decide(left);
}

type TypedValue = { value: LuaValue };

function evalExprWithNumericType(
  expr: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
  _wantNumericType: boolean,
): TypedValue | Promise<TypedValue> {
  const v = evalExpression(expr, env, sf);
  const apply = (vv: any): TypedValue => ({ value: vv });
  return rpThen(v, apply) as any;
}

function getSimpleLiteralType(expr: LuaExpression): NumericType | undefined {
  if (expr.type === "Number") {
    return expr.numericType === "int" ? "int" : "float";
  }
  if (
    expr.type === "Unary" &&
    (expr.operator === "+" || expr.operator === "-") &&
    expr.argument.type === "Number"
  ) {
    return expr.argument.numericType === "int" ? "int" : "float";
  }
  return undefined;
}

function evalBinaryWithLR(
  op: string,
  leftExpr: LuaExpression,
  rightExpr: LuaExpression,
  ctx: ASTCtx,
  env: LuaEnv,
  sf: LuaStackFrame,
): any {
  const wantNumericType = isNumericBinaryOp(op);
  const leftType = wantNumericType ? getSimpleLiteralType(leftExpr) : undefined;
  const rightType = wantNumericType
    ? getSimpleLiteralType(rightExpr)
    : undefined;
  const leftVal = evalExpression(leftExpr, env, sf);

  const applyLeft = (lv: any) => {
    const rightVal = evalExpression(rightExpr, env, sf);
    const applyRight = (rv: any) => {
      return luaOp(
        op,
        singleResult(lv),
        singleResult(rv),
        leftType,
        rightType,
        ctx,
        sf,
      );
    };
    return rpThen(rightVal, applyRight);
  };
  return rpThen(leftVal, applyLeft);
}

function createBitwiseError(
  val: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): LuaRuntimeError {
  if (typeof val === "string") {
    return new LuaRuntimeError(
      `attempt to perform bitwise operation on a string value (constant '${val}')`,
      sf.withCtx(ctx),
    );
  }
  const t = luaTypeName(val);
  if (t === "number") {
    return new LuaRuntimeError(
      `number has no integer representation`,
      sf.withCtx(ctx),
    );
  }
  return new LuaRuntimeError(
    `attempt to perform bitwise operation on a ${t} value`,
    sf.withCtx(ctx),
  );
}

function getBinaryMM(
  a: any,
  b: any,
  mmName: string,
  sf: LuaStackFrame,
): any | null {
  // Look in a's metatable first; if absent, look in b's.
  const ma = getMetatable(a, sf);
  if (ma) {
    const mmA = ma.rawGet(mmName);
    if (!(mmA === undefined || mmA === null)) {
      return mmA;
    }
  }
  const mb = getMetatable(b, sf);
  if (mb) {
    const mmB = mb.rawGet(mmName);
    if (!(mmB === undefined || mmB === null)) {
      return mmB;
    }
  }
  return null;
}

function luaEqWithMetamethod(
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): boolean | Promise<boolean> {
  if (luaEquals(a, b)) {
    return true;
  }

  const ta = luaTypeName(a);
  const tb = luaTypeName(b);

  // __eq only applies to tables/userdata
  const aOk = ta === "table" || ta === "userdata";
  const bOk = tb === "table" || tb === "userdata";
  if (!aOk || !bOk) {
    return false;
  }

  const getEqMM = (obj: any): any | null => {
    const mt = getMetatable(obj, sf);
    if (!mt) return null;

    const mm = mt.rawGet("__eq");
    if (mm === undefined || mm === null) return null;

    if (typeof mm === "function" || isILuaFunction(mm)) {
      return mm;
    }

    const ty = luaTypeName(mm);
    throw new LuaRuntimeError(
      `attempt to call a ${ty} value`,
      sf.withCtx(ctx),
    );
  };

  // Try left __eq first, then right.
  const mm = getEqMM(a) ?? getEqMM(b);
  if (!mm) {
    return false;
  }

  const r = luaCall(mm, [a, b], ctx, sf);
  return isPromise(r)
    ? (r as Promise<any>).then((v) => !!singleResult(v))
    : !!singleResult(r);
}

function luaRelWithMetamethod(
  op: "<" | "<=",
  a: any,
  b: any,
  ctx: ASTCtx,
  sf: LuaStackFrame,
): boolean | Promise<boolean> {
  const an = isTaggedFloat(a) ? a.value : a;
  const bn = isTaggedFloat(b) ? b.value : b;

  if (typeof an === "number" && typeof bn === "number") {
    return op === "<" ? an < bn : an <= bn;
  }
  if (typeof an === "string" && typeof bn === "string") {
    return op === "<" ? an < bn : an <= bn;
  }

  const mmName = op === "<" ? "__lt" : "__le";
  const mm = getBinaryMM(a, b, mmName, sf);
  if (mm) {
    const r = luaCall(mm, [a, b], ctx, sf);
    if (isPromise(r)) {
      return (r as Promise<any>).then((v) => !!singleResult(v));
    }
    return !!singleResult(r);
  }

  throw new LuaRuntimeError(
    `attempt to compare ${luaTypeName(a)} with ${luaTypeName(b)}`,
    sf.withCtx(ctx),
  );
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
    if (mt) {
      const fn = mt.rawGet("__len");
      if (!(fn === undefined || fn === null)) {
        return luaCall(fn, [val], ctx, sf);
      }
    }
    return val.length;
  }

  // Other values: allow metatable `__len` first
  {
    const mt = getMetatable(val, sf);
    if (mt) {
      const fn = mt.rawGet("__len");
      if (!(fn === undefined || fn === null)) {
        return luaCall(fn, [val], ctx, sf);
      }
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

  // In Lua multi-returns propagate only in tail position of an expression list.
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
        }
        if (isGotoSignal(r)) return r;
        if (r !== undefined) return r;
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
      }
      if (
        isPromise(valuesRP) && !isPromise(lvaluesRP)
      ) {
        return (valuesRP as Promise<LuaValue[]>).then((values: LuaValue[]) =>
          apply(values, lvaluesRP as LuaLValueContainer[])
        );
      }
      if (
        !isPromise(valuesRP) && isPromise(lvaluesRP)
      ) {
        return (lvaluesRP as Promise<any[]>).then((lvalues: any[]) =>
          apply(valuesRP as LuaValue[], lvalues)
        );
      }
      return (valuesRP as Promise<LuaValue[]>).then((values: LuaValue[]) =>
        (lvaluesRP as Promise<any[]>).then((lvalues: any[]) =>
          apply(values, lvalues)
        )
      );
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
          bindOne(
            l.names[boundCount],
            out[boundCount] ?? null,
          );
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
              const flat = v.flatten();
              for (let k = 0; k < flat.values.length; k++) {
                out.push(flat.values[k]);
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
        }
        if (luaTruthy(cv)) {
          return evalStatement(conds[i].block, env, sf, returnOnReturn);
        }
        return runFrom(i + 1);
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
              }
              if (r !== undefined) {
                if (isBreakSignal(r)) {
                  return;
                }
                return r;
              }
              return runAsync();
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
        }
        if (r !== undefined) {
          if (isBreakSignal(r)) {
            break;
          }
          return r;
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
        }
        if (rr !== undefined) {
          if (isBreakSignal(rr)) {
            return;
          }
          return rr;
        }

        const c = evalExpression(r.condition, env, sf);
        if (isPromise(c)) {
          return (c as Promise<any>).then((cv) =>
            luaTruthy(cv) ? undefined : runAsync()
          );
        }
        if (luaTruthy(c)) {
          break;
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
      let settable: ILuaGettable = env;
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

      const parts = ret.expressions.map((value: LuaExpression) =>
        evalExpression(value, env, sf)
      );
      const valuesRP = rpAll(parts);

      const finalize = (vals: any[]): ReturnSignal => {
        const outVals: LuaValue[] = [];

        if (vals.length === 0) {
          return { ctrl: "return", values: outVals };
        }

        for (let i = 0; i < vals.length; i++) {
          const isLast = i === vals.length - 1;
          const v = vals[i];

          if (!isLast) {
            outVals.push(singleResult(v));
            continue;
          }

          if (v instanceof LuaMultiRes) {
            const flat = v.flatten();
            outVals.push(...flat.values);
          } else {
            outVals.push(v);
          }
        }

        return {
          ctrl: "return" as const,
          values: outVals,
        };
      };

      if (isPromise(valuesRP)) {
        return (valuesRP as Promise<any[]>).then((vals) => finalize(vals));
      }
      return finalize(valuesRP as any[]);
    }
    case "For": {
      const fr = asFor(s);
      const startV = evalExpression(fr.start, env, sf);
      const endV = evalExpression(fr.end, env, sf);
      const stepV = fr.step ? evalExpression(fr.step, env, sf) : 1;

      const determineLoopType = (): NumericType => {
        const startType = astNumberKind(fr.start);
        const stepType = fr.step ? astNumberKind(fr.step) : "int";
        return (startType === "float" || stepType === "float")
          ? "float"
          : "int";
      };

      const wrapLoopVar = (i: number, loopType: NumericType) => {
        if (loopType === "float") {
          return makeLuaFloat(i);
        }
        return i;
      };

      const canReuseEnv = !fr.block.hasFunctionDef ||
        fr.capturesLoopVar === false;

      const executeIteration = canReuseEnv
        ? (
          loopEnv: LuaEnv,
          i: number,
          loopType: NumericType,
        ): void | ControlSignal | Promise<void | ControlSignal> => {
          loopEnv.setLocal(fr.name, wrapLoopVar(i, loopType));
          return evalStatement(fr.block, loopEnv, sf, returnOnReturn);
        }
        : (
          _loopEnv: LuaEnv,
          i: number,
          loopType: NumericType,
        ): void | ControlSignal | Promise<void | ControlSignal> => {
          const localEnv = new LuaEnv(env);
          localEnv.setLocal(fr.name, wrapLoopVar(i, loopType));
          return evalStatement(fr.block, localEnv, sf, returnOnReturn);
        };

      const runAsync = async (
        loopEnv: LuaEnv,
        end: number,
        step: number,
        startIndex: number,
        loopType: NumericType,
      ) => {
        if (step === 0) {
          throw new LuaRuntimeError("'for' step is zero", sf.withCtx(fr.ctx));
        }

        const shouldContinue = step > 0
          ? (i: number) => i <= end
          : (i: number) => i >= end;

        for (let i = startIndex; shouldContinue(i); i += step) {
          const r = executeIteration(loopEnv, i, loopType);
          const res = isPromise(r) ? await r : r;
          if (res !== undefined) {
            if (isBreakSignal(res)) {
              return;
            }
            return res;
          }
        }
      };

      const runSyncFirst = (
        start: number,
        end: number,
        step: number,
        loopType: NumericType,
      ):
        | void
        | ControlSignal
        | Promise<void | ControlSignal> => {
        if (step === 0) {
          throw new LuaRuntimeError("'for' step is zero", sf.withCtx(fr.ctx));
        }

        const shouldContinue = step > 0
          ? (i: number) => i <= end
          : (i: number) => i >= end;

        const loopEnv = new LuaEnv(env);

        for (let i = start; shouldContinue(i); i += step) {
          const r = executeIteration(loopEnv, i, loopType);
          if (isPromise(r)) {
            return (r as Promise<any>).then((res) => {
              if (res !== undefined) {
                if (isBreakSignal(res)) {
                  return;
                }
                return res;
              }
              return runAsync(loopEnv, end, step, i + step, loopType);
            });
          }
          if (r !== undefined) {
            if (isBreakSignal(r)) {
              return;
            }
            return r;
          }
        }
        return;
      };

      const loopType = determineLoopType();

      if (
        !isPromise(startV) &&
        !isPromise(endV) &&
        !isPromise(stepV)
      ) {
        return runSyncFirst(
          untagNumber(startV) as number,
          untagNumber(endV) as number,
          untagNumber(stepV ?? 1) as number,
          loopType,
        );
      }
      return Promise.all([
        isPromise(startV) ? startV : Promise.resolve(startV),
        isPromise(endV) ? endV : Promise.resolve(endV),
        isPromise(stepV) ? stepV : Promise.resolve(stepV),
      ]).then(([start, end, step]) => {
        return runSyncFirst(
          untagNumber(start) as number,
          untagNumber(end) as number,
          untagNumber(step ?? 1) as number,
          loopType,
        );
      });
    }
    case "ForIn": {
      const fi = asForIn(s);
      const exprVals = rpAll(
        fi.expressions.map((e: LuaExpression) => evalExpression(e, env, sf)),
      );

      const canReuseEnv = !fi.block.hasFunctionDef ||
        fi.capturesLoopVar === false;
      const setIterVars = (
        localEnv: LuaEnv,
        names: string[],
        values: LuaValue[],
      ) => {
        for (let i = 0; i < names.length; i++) {
          localEnv.setLocal(names[i], values[i]);
        }
      };

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

        const closeStack = luaEnsureCloseStack(sf);
        const mark = closeStack.length;

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

        // Allocate the reusable env once before the loop
        const loopEnv = canReuseEnv ? new LuaEnv(env) : null;

        const makeIterEnv = (): LuaEnv => {
          if (loopEnv) {
            return loopEnv;
          }
          return new LuaEnv(env);
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

              const localEnv = makeIterEnv();
              setIterVars(localEnv, fi.names, iterResult.values);

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

                const localEnv = makeIterEnv();
                setIterVars(localEnv, fi.names, iterResult.values);

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
                }
                if (r !== undefined) {
                  if (isBreakSignal(r)) {
                    return finish(undefined);
                  }
                  return rpThen(finish(undefined), () => r);
                }
                return runAsync();
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

            const localEnv = makeIterEnv();
            setIterVars(localEnv, fi.names, iterResult.values);

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
            }
            if (r !== undefined) {
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
      }
      return afterExprs(exprVals as any[]);
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
      }
      return {
        env: singleResult(objValue),
        key: singleResult(keyValue),
      };
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
      }
      return {
        env: objValue,
        key: pa.property,
      };
    }
  }
}
