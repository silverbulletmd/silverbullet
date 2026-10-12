/**
 * Hints for common mistakes (mostly SQL habits and misread docs), appended to
 * Lua parse and runtime errors as "; hint: ...".
 *
 * Parse-time hints read the lezer tree around the error node, so look-alikes
 * inside string literals and comments never match.
 */
import type { SyntaxNode } from "@lezer/common";
import type { ASTCtx, LuaExpression } from "./ast.ts";
import type { asFunctionCall } from "./ast_narrow.ts";
import {
  type LuaEnv,
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
  luaTypeOf,
  type LuaValue,
} from "./runtime.ts";

// Parse errors

const STATEMENT_KEYWORDS = new Set([
  "local",
  "if",
  "for",
  "while",
  "repeat",
  "do",
  "goto",
  "break",
]);

const SLIQ_EXAMPLE = `from p = index.pages("tag") where p.status == "open" select p.name`;

/** The word (identifier or keyword) starting at `pos`, if any. */
function wordAt(src: string, pos: number): string | undefined {
  return /^[A-Za-z_]\w*/.exec(src.slice(pos))?.[0];
}

/** Leaf tokens of `node` that end at or before `to`, error nodes excluded. */
function leavesBefore(node: SyntaxNode, to: number): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const cursor = node.cursor();
  do {
    if (!cursor.type.isError && !cursor.node.firstChild && cursor.to <= to) {
      out.push(cursor.node);
    }
  } while (cursor.next() && cursor.from < to);
  return out;
}

function closestAncestor(
  node: SyntaxNode,
  names: string[],
): SyntaxNode | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (names.includes(p.type.name)) return p;
  }
  return undefined;
}

const QUERY_CLAUSES = [
  "FromClause",
  "WhereClause",
  "HavingClause",
  "SelectClause",
  "OrderByClause",
  "GroupByClause",
  "LimitClause",
  "OffsetClause",
];

export function syntaxHint(
  src: string,
  errNode: SyntaxNode,
  pos: number,
): string | undefined {
  const sym = src[pos];
  const word = wordAt(src, pos);
  const clause = closestAncestor(errNode, [
    ...QUERY_CLAUSES,
    "Query",
    "TableConstructor",
    "IfStatement",
    "WhileStatement",
    "RepeatStatement",
    "Block",
    "FuncBody",
    "Local",
    "Assign",
  ])?.type.name;
  const inCondition =
    clause === "WhereClause" ||
    clause === "HavingClause" ||
    clause === "IfStatement" ||
    clause === "WhileStatement" ||
    clause === "RepeatStatement";

  if (sym === "=" && inCondition) {
    return src[pos + 1] === "~"
      ? "use == to compare, or string.match(s, pattern) to match a pattern"
      : "use == to compare";
  }

  if (inCondition && word) {
    switch (word.toLowerCase()) {
      case "like":
      case "ilike":
        return 'there is no LIKE; use s:startsWith("x"), s:endsWith("x"), s:find("x", 1, true) or s:match(pattern)';
      case "contains":
        return 'there is no infix contains; use table.includes(list, value) for a list, or s:find("x", 1, true) for a substring';
      case "in":
        return 'there is no infix in; use table.includes(list, value), e.g. table.includes({"a", "b"}, x)';
      case "is":
        return "use == nil or ~= nil instead of IS NULL / IS NOT NULL";
      case "startswith":
      case "endswith":
        return `call it as a method: s:${word}("x")`;
    }
  }

  const query = closestAncestor(errNode, ["Query"]);
  if (query) {
    const afterKeyword = query.from + "query".length;
    const opening = /^\s*(\[\[)?\s*/.exec(src.slice(afterKeyword))!;
    if (!opening[1] && pos === afterKeyword + opening[0].length) {
      return "query is syntax, not a function: write query[[from x = ... ]] and use Lua variables directly inside it";
    }
    if (opening[1] && pos === afterKeyword + opening[0].length) {
      return `SLIQ queries start with from, e.g. ${SLIQ_EXAMPLE}`;
    }
  }

  const prev = leavesBefore(errNode.parent ?? errNode, pos);
  const last = prev[prev.length - 1];
  const lastText = (n?: SyntaxNode) => n && src.slice(n.from, n.to);

  if (sym === "*" && clause === "SelectClause" && lastText(last) === "select") {
    return "there is no select *; leave out select to get whole rows";
  }

  if (sym === "[" && errNode.prevSibling?.type.name === "Query") {
    return "wrap the query in parentheses to index it: (query[[...]])[1]";
  }

  const table = closestAncestor(errNode, ["TableConstructor"]);
  if (table) {
    const field = fieldContaining(table, errNode.from);
    if (field) {
      const leaves = leavesBefore(field, field.to);
      if (
        leaves[0]?.type.name === "Name" &&
        lastText(leaves[1]) === ":" &&
        leaves[0].to <= pos
      ) {
        return `use = in table constructors: {${lastText(leaves[0])} = ...}`;
      }
    }
  }

  if (
    errNode.parent?.type.name === "ReturnStatement" &&
    word &&
    (word === "return" || STATEMENT_KEYWORDS.has(word)) &&
    prev.length === 1
  ) {
    return word === "return"
      ? "an expression is expected here and is returned already; drop the 'return', or run statements as a script (sb script)"
      : `an expression is expected here, but '${word}' starts a statement; run statements as a script (sb script)`;
  }

  if (
    sym === ":" &&
    lastText(last) === "s" &&
    lastText(prev[prev.length - 2]) === ":"
  ) {
    const method = wordAt(src, pos + 1);
    if (method) {
      return sNotationHint(
        dottedNameBefore(src, prev, prev.length - 3),
        method,
      );
    }
  }

  return undefined;
}

/** The direct child of `table` (a field) that contains `pos`. */
function fieldContaining(
  table: SyntaxNode,
  pos: number,
): SyntaxNode | undefined {
  for (let ch = table.firstChild; ch; ch = ch.nextSibling) {
    if (ch.from <= pos && pos <= ch.to && ch.type.name.startsWith("Field")) {
      return ch;
    }
  }
  return undefined;
}

/** Source of the `a.b.c` chain of leaves ending at index `end`. */
function dottedNameBefore(
  src: string,
  leaves: SyntaxNode[],
  end: number,
): string | undefined {
  let start = end;
  if (leaves[start]?.type.name !== "Name") return undefined;
  while (
    start >= 2 &&
    src.slice(leaves[start - 1].from, leaves[start - 1].to) === "." &&
    leaves[start - 2].type.name === "Name"
  ) {
    start -= 2;
  }
  return src.slice(leaves[start].from, leaves[end].to);
}

// Runtime errors

/**
 * Point a query author at the likely cause of calling an undefined global,
 * e.g. `where s:startsWith(p.name, "x")` in a query that binds `p`.
 */
export function withQueryHint(err: unknown, boundNames: string[]): unknown {
  if (!(err instanceof LuaRuntimeError)) {
    return err;
  }
  const m = /^attempt to (?:call|index) a nil value \(global '([^']+)'\)$/.exec(
    err.message,
  );
  if (!m || boundNames.includes(m[1])) {
    return err;
  }
  const name = m[1];
  const hint =
    boundNames.length === 0
      ? `'${name}' is not defined as a global or a field of the row`
      : `'${name}' is not defined; this query binds each row to ${boundNames
          .map((n) => `'${n}'`)
          .join(", ")} (from ${boundNames[0]} = ...)`;
  return new LuaRuntimeError(`${err.message}; hint: ${hint}`, err.sf, err);
}

export function withHint(msg: string, hint: string | undefined): string {
  return hint ? `${msg}; hint: ${hint}` : msg;
}

/** Whether `name` resolves to a local (any scope but the global root). */
function isLocalName(env: LuaEnv, name: string): boolean {
  for (let e: LuaEnv | undefined = env; e; e = e.parent) {
    if (e.variables.has(name)) {
      return e.parent !== undefined;
    }
  }
  return false;
}

/** Stock Lua's description of where a nil came from, e.g. `global 'x'`. */
function describeNilSource(e: LuaExpression, env: LuaEnv): string | undefined {
  switch (e.type) {
    case "Variable":
      return `${isLocalName(env, e.name) ? "local" : "global"} '${e.name}'`;
    case "PropertyAccess":
      return `field '${e.property}'`;
    case "TableAccess":
      return e.key.type === "String" ? `field '${e.key.value}'` : undefined;
    default:
      return undefined;
  }
}

/** Source text of a plain `a.b.c` chain, if `e` is one. */
function dottedName(e: LuaExpression): string | undefined {
  if (e.type === "Variable") {
    return e.name;
  }
  if (e.type === "PropertyAccess") {
    const obj = dottedName(e.object);
    return obj === undefined ? undefined : `${obj}.${e.property}`;
  }
  return undefined;
}

/**
 * Docs write string methods as `s:startsWith("x")`; authors sometimes keep
 * the `s` (`p.name.s:startsWith(...)`, `p.name:s:startsWith(...)`).
 */
function sNotationHint(receiver: string | undefined, method: string) {
  return `in s:${method}("x"), 's' stands for the string itself${
    receiver ? `; write ${receiver}:${method}(...)` : ""
  }`;
}

function nilErrorMessage(
  verb: "call" | "index",
  e: LuaExpression,
  env: LuaEnv,
): string {
  const src = describeNilSource(e, env);
  return `attempt to ${verb} a nil value${src ? ` (${src})` : ""}`;
}

export function nonNilForIndex(
  obj: LuaValue,
  objExpr: LuaExpression,
  env: LuaEnv,
  sf: LuaStackFrame,
  ctx: ASTCtx,
): LuaValue {
  if (obj === null || obj === undefined) {
    throw new LuaRuntimeError(
      nilErrorMessage("index", objExpr, env),
      sf.withCtx(ctx),
    );
  }
  return obj;
}

export function nilPrefixError(
  fc: ReturnType<typeof asFunctionCall>,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaRuntimeError {
  if (!fc.name) {
    return new LuaRuntimeError(
      nilErrorMessage("call", fc.prefix, env),
      sf.withCtx(fc.prefix.ctx),
    );
  }
  const p = fc.prefix;
  const hint =
    p.type === "PropertyAccess" && p.property === "s"
      ? sNotationHint(dottedName(p.object), fc.name)
      : undefined;
  return new LuaRuntimeError(
    withHint(nilErrorMessage("index", p, env), hint),
    sf.withCtx(p.ctx),
  );
}

export function missingMethodHint(
  self: LuaValue,
  name: string,
): string | undefined {
  const ty = luaTypeOf(self);
  if (ty === "string") {
    return name === "contains" || name === "includes"
      ? `strings have no '${name}' method; use s:find("x", 1, true) to test for a substring, or s:startsWith("x") / s:endsWith("x")`
      : `strings have no '${name}' method; string methods include find, match, gmatch, gsub, sub, split, startsWith, endsWith, trim, lower and upper`;
  }
  if (
    ty === "table" &&
    !(self instanceof LuaTable && self.metatable) &&
    (name === "contains" || name === "includes" || name === "has")
  ) {
    return `tables have no '${name}' method; use table.includes(t, value)`;
  }
  return undefined;
}
