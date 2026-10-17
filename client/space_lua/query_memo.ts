import type {
  LuaExpression,
  LuaFunctionBody,
  LuaFunctionCallExpression,
  LuaMemoExpression,
  LuaOrderBy,
  LuaQueryClause,
  LuaTableField,
} from "./ast.ts";

type Node =
  LuaExpression | LuaTableField | LuaQueryClause | LuaOrderBy | LuaFunctionBody;

// `null` marks nested query clauses the rewriter must not split: those of an
// unbound `from expr` or a cross-join (row names can't be told apart from
// globals), and `select`, `having`, `order by` and `group by` of any nested
// query. The latter see bare per-group names (`key`, `group`, group-by aliases,
// first-item fields) and contain aggregate calls that the aggregate machinery
// must find unwrapped, and `select` derives column names from node shape.
type Scope = ReadonlySet<string> | null;

// "call": the slot must stay a FunctionCall, so it is never wrapped itself.
type Position = "expr" | "call" | "other";

type Visit = (child: any, scope: Scope, pos: Position) => any;

type Template = {
  root: LuaExpression;
  memos: WeakSet<object>;
  ancestors: WeakSet<object>;
};

const templates = new WeakMap<LuaExpression, Map<string, Template>>();

/**
 * Wraps the maximal row-invariant sub-expressions of a `where` clause that
 * contain a call in `Memo` nodes. Each call returns fresh, empty memo cells;
 * the input is never mutated and is returned as-is when nothing qualifies.
 */
export function memoizeRowInvariants(
  where: LuaExpression,
  objectVariable: string,
): LuaExpression {
  let byVar = templates.get(where);
  if (!byVar) {
    byVar = new Map();
    templates.set(where, byVar);
  }
  let template = byVar.get(objectVariable);
  if (!template) {
    template = {
      root: where,
      memos: new WeakSet(),
      ancestors: new WeakSet(),
    };
    template.root = rewrite(where, new Set([objectVariable]), "expr", template);
    byVar.set(objectVariable, template);
  }
  return instantiate(template);
}

function instantiate(template: Template): LuaExpression {
  const copy = (value: any): any => {
    if (value === null || typeof value !== "object") return value;
    if (template.memos.has(value)) {
      return { ...value, cell: { state: "empty" } };
    }
    if (!template.ancestors.has(value)) return value;
    if (Array.isArray(value)) return value.map(copy);
    const out: any = {};
    for (const key of Object.keys(value)) out[key] = copy(value[key]);
    return out;
  };
  return copy(template.root);
}

function rewrite<N extends Node>(
  node: N,
  scope: Scope,
  pos: Position,
  template: Template,
): N {
  if (scope === null) return node;
  if (node.type === "Memo") return node;
  if (pos === "expr" && !isRowDependent(node, scope) && hasCall(node)) {
    const expression = node as LuaExpression;
    const memo = {
      type: "Memo",
      expression,
      ctx: expression.ctx,
    } as LuaMemoExpression;
    template.memos.add(memo);
    return memo as N;
  }
  if (node.type === "FunctionDefinition" || node.type === "FunctionBody") {
    return node;
  }
  const out = mapChildren(node, scope, (child, childScope, childPos) =>
    rewrite(child, childScope, childPos, template),
  );
  if (out !== node) markAncestor(out, template);
  return out;
}

function markAncestor(node: any, template: Template) {
  template.ancestors.add(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) template.ancestors.add(value);
  }
}

// Judged against `vars` only: a nested query's own bindings are bound inside
// it, so they never make the query as a whole depend on the outer row. An
// inner binding that shadows a name in `vars` still counts (conservative).
function isRowDependent(node: Node, vars: ReadonlySet<string>): boolean {
  switch (node.type) {
    case "Memo":
      return false;
    case "Variable":
      return vars.has(node.name);
    case "FunctionCall":
      if (isDenylisted(node)) return true;
      break;
    case "FunctionDefinition":
      return mentions(node.body, vars);
    case "FunctionBody":
      return mentions(node, vars);
    case "Order":
      if (typeof node.using === "string" && vars.has(node.using)) return true;
      break;
  }
  let found = false;
  mapChildren(node, vars, (child) => {
    if (!found && isRowDependent(child, vars)) found = true;
    return child;
  });
  return found;
}

function hasCall(node: Node): boolean {
  switch (node.type) {
    case "FunctionCall":
    case "FilteredCall":
    case "Query":
      return true;
    case "FunctionDefinition":
    case "FunctionBody":
      return false;
  }
  let found = false;
  mapChildren(node, null, (child) => {
    if (!found && hasCall(child)) found = true;
    return child;
  });
  return found;
}

// Conservative scan of a function body: any matching variable or denylisted
// call anywhere counts, regardless of local shadowing.
function mentions(value: any, vars: ReadonlySet<string>): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => mentions(v, vars));
  if (value.type === "Variable" && vars.has(value.name)) return true;
  if (value.type === "FunctionCall" && isDenylisted(value)) return true;
  if (
    value.type === "Order" &&
    typeof value.using === "string" &&
    vars.has(value.using)
  ) {
    return true;
  }
  for (const key of Object.keys(value)) {
    if (key !== "ctx" && mentions(value[key], vars)) return true;
  }
  return false;
}

// Syntactic, best-effort match: aliases or wrappers of math.random are cached.
function isDenylisted(call: LuaFunctionCallExpression): boolean {
  const prefix = call.prefix;
  return (
    !call.name &&
    prefix.type === "PropertyAccess" &&
    prefix.property === "random" &&
    prefix.object.type === "Variable" &&
    prefix.object.name === "math"
  );
}

/**
 * Generic child enumerator: calls `f` on each child with the scope and
 * position it lives in, and returns a shallow copy with the results when any
 * child changed (the same node otherwise).
 */
function mapChildren<N extends Node>(node: N, vars: Scope, f: Visit): N {
  let changed = false;
  const one = <C>(child: C, scope: Scope, pos: Position): C => {
    const result = f(child, scope, pos);
    if (result !== child) changed = true;
    return result;
  };
  const many = <C>(children: C[], scope: Scope, pos: Position): C[] => {
    const result = children.map((c) => one(c, scope, pos));
    return result.some((r, i) => r !== children[i]) ? result : children;
  };
  const n = node as Node;
  let out: Node;
  switch (n.type) {
    case "Nil":
    case "Boolean":
    case "Number":
    case "String":
    case "Variable":
    case "FunctionDefinition":
    case "FunctionBody":
      return node;
    case "Parenthesized":
    case "Memo":
    case "Where":
    case "Having":
      out = { ...n, expression: one(n.expression, vars, "expr") };
      break;
    case "Unary":
      out = { ...n, argument: one(n.argument, vars, "expr") };
      break;
    case "Binary":
      out = {
        ...n,
        left: one(n.left, vars, "expr"),
        right: one(n.right, vars, "expr"),
      };
      break;
    case "PropertyAccess":
      out = { ...n, object: one(n.object, vars, "expr") };
      break;
    case "TableAccess":
      out = {
        ...n,
        object: one(n.object, vars, "expr"),
        key: one(n.key, vars, "expr"),
      };
      break;
    case "FunctionCall":
      out = {
        ...n,
        prefix: one(n.prefix, vars, "expr"),
        args: many(n.args, vars, "expr"),
      };
      if (n.orderBy) out.orderBy = many(n.orderBy, vars, "other");
      break;
    case "FilteredCall":
      out = {
        ...n,
        call: one(n.call, vars, "call"),
        filter: one(n.filter, vars, "expr"),
      };
      break;
    case "AggregateCall":
      out = {
        ...n,
        call: one(n.call, vars, "call"),
        orderBy: many(n.orderBy, vars, "other"),
      };
      break;
    case "TableConstructor":
    case "From":
    case "Select":
    case "GroupBy":
      out = { ...n, fields: many(n.fields, vars, "other") };
      break;
    case "DynamicField":
      out = {
        ...n,
        key: one(n.key, vars, "expr"),
        value: one(n.value, vars, "expr"),
      };
      break;
    case "PropField":
    case "ExpressionField":
      out = { ...n, value: one(n.value, vars, "expr") };
      break;
    case "Limit":
      out = { ...n, limit: one(n.limit, vars, "expr") };
      if (n.offset) out.offset = one(n.offset, vars, "expr");
      break;
    case "Offset":
      out = { ...n, offset: one(n.offset, vars, "expr") };
      break;
    case "OrderBy":
      out = { ...n, orderBy: many(n.orderBy, vars, "other") };
      break;
    case "Order":
      out = { ...n, expression: one(n.expression, vars, "expr") };
      if (n.using && typeof n.using !== "string") {
        out.using = one(n.using, vars, "other");
      }
      break;
    case "Query": {
      const inner = nestedQueryScope(n.clauses, vars);
      const clauses = n.clauses.map((c) =>
        one(c, nestedClauseScope(c, vars, inner), "other"),
      );
      out = { ...n, clauses };
      break;
    }
    default: {
      const unknown: never = n;
      throw new Error(`Unexpected node type ${(unknown as Node).type}`);
    }
  }
  return (changed ? out : node) as N;
}

function nestedClauseScope(
  clause: LuaQueryClause,
  vars: Scope,
  inner: Scope,
): Scope {
  switch (clause.type) {
    case "From":
      return vars;
    case "Where":
    case "Limit":
    case "Offset":
      return inner;
    default:
      return null;
  }
}

function nestedQueryScope(clauses: LuaQueryClause[], vars: Scope): Scope {
  if (vars === null) return null;
  const from = clauses.find((c) => c.type === "From");
  if (from?.fields.length === 1 && from.fields[0].type === "PropField") {
    return new Set([...vars, from.fields[0].key]);
  }
  return null;
}
