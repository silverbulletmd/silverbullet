/**
 * Turns `query[[…]]` text back into a builder model, best effort: what the
 * builder has a control for becomes that control (an attribute filter, a group
 * key…), other Lua is kept as an expression, and a query the model can't
 * hold (an offset, a `having`, a computed group key…) is refused with the
 * reason.
 *
 * A filter is recognized by generating each operator's Lua for the attribute it
 * reads and comparing syntax trees, so `query_ops.ts` stays the one
 * definition of what each operator writes.
 */
import type {
  LuaExpression,
  LuaFunctionCallExpression,
  LuaOrderBy,
  LuaQueryExpression,
  LuaTableField,
} from "../../space_lua/ast.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import type { AttributeInfo } from "./query_attributes.ts";
import { type QuerySource, sourceFromCall } from "./query_from.ts";
import {
  emptyModel,
  attributeAccess,
  attributeType,
  type GroupColumn,
  newId,
  type QueryModel,
  type QuerySelect,
  type Sort,
  type SortBy,
  type TableColumn,
} from "./query_model.ts";
import { type Filter, filterLua, operatorsFor } from "./query_ops.ts";

export type ParsedQuery =
  | { ok: true; model: QueryModel; notes: string[] }
  | { ok: false; reason: string };

/** Raised for what the model can't hold; becomes the refusal's reason */
class Unsupported extends Error {}

function refuse(reason: string): never {
  throw new Unsupported(reason);
}

/** The text without a directive's `${…}` around it */
function unwrap(text: string): string {
  const t = text.trim();
  return t.startsWith("${") && t.endsWith("}") ? t.slice(2, -1) : t;
}

function parseQueryAst(text: string): LuaQueryExpression {
  let e: LuaExpression;
  try {
    e = parseExpressionString(text);
  } catch {
    refuse("The query doesn't parse");
  }
  if (e.type !== "Query") refuse("This isn't a query[[…]]");
  return e;
}

/** The syntax tree without positions, to compare two trees */
function shape(node: unknown): string {
  return JSON.stringify(node, (k, v) => (k === "ctx" ? undefined : v));
}

function sameTree(a: unknown, b: unknown): boolean {
  return shape(a) === shape(b);
}

/** The source: an `index.*()` call, with or without a variable */
function fromClause(q: LuaQueryExpression): {
  source: QuerySource;
  binding: string | null;
} {
  const from = q.clauses.filter((c) => c.type === "From");
  if (from.length !== 1 || from[0].fields.length !== 1) {
    refuse("Only a query over one index.* collection can be edited");
  }
  const field = from[0].fields[0];
  const value = field.value;
  const call =
    value.type === "FunctionCall" &&
    value.prefix.type === "PropertyAccess" &&
    value.prefix.object.type === "Variable" &&
    value.prefix.object.name === "index" &&
    value.args.length <= 1 &&
    value.args.every((a) => a.type === "String")
      ? (value as LuaFunctionCallExpression)
      : null;
  const source = call
    ? sourceFromCall(
        (call.prefix as { property: string }).property,
        call.args.length ? (call.args[0] as { value: string }).value : null,
      )
    : null;
  if (!source) refuse("Only a query over an index.* collection can be edited");
  if (field.type === "PropField") return { source, binding: field.key };
  if (field.type === "ExpressionField") return { source, binding: null };
  refuse("Only a query over an index.* collection can be edited");
}

/** The source a query reads, or null when the builder can't show it */
export function querySource(text: string): QuerySource | null {
  try {
    return fromClause(parseQueryAst(unwrap(text))).source;
  } catch {
    return null;
  }
}

export function parseQuery(
  text: string,
  attributes: AttributeInfo[],
): ParsedQuery {
  try {
    return { ok: true, ...new Reader(unwrap(text), attributes).read() };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: e.message };
    throw e;
  }
}

class Reader {
  private notes: string[] = [];
  private model!: QueryModel;
  private v = "_";
  /** Where the text starts in the positions the parser gives */
  private base = 0;

  constructor(
    private text: string,
    private attributes: AttributeInfo[],
  ) {}

  read(): { model: QueryModel; notes: string[] } {
    const q = parseQueryAst(this.text);
    this.base = q.ctx.from ?? 0;
    const { source, binding } = fromClause(q);
    this.v = binding ?? "_";
    this.model = { ...emptyModel(source, this.attributes), binding };
    const m = this.model;
    // Each column's syntax tree, to know an `order by` on it
    const columnTrees = new Map<string, LuaExpression>();
    let order: LuaOrderBy[] = [];
    for (const c of q.clauses) {
      switch (c.type) {
        case "From":
          break;
        case "Where":
          m.filters.push(...this.filters(c.expression));
          break;
        case "GroupBy":
          m.group = c.fields.map((f) => this.groupKey(f));
          break;
        case "OrderBy":
          order = c.orderBy;
          break;
        case "Limit":
          if (c.offset) refuse("The builder has no offset");
          if (c.limit.type !== "Number") refuse("The limit isn't a number");
          m.limit = c.limit.value;
          break;
        case "Offset":
          refuse("The builder has no offset");
          break;
        case "Having":
          refuse("The builder has no having");
          break;
        case "Select":
          // Read once the group keys are known, below
          break;
      }
    }
    const select = q.clauses.find((c) => c.type === "Select");
    if (select) {
      if (
        select.fields.length !== 1 ||
        select.fields[0].type !== "ExpressionField"
      ) {
        refuse("The builder can't show this select");
      }
      const value = select.fields[0].value;
      if (m.group.length) {
        m.groupColumns = this.groupColumns(value, columnTrees);
      } else {
        m.select = this.select(value);
      }
    } else if (!m.group.length) {
      this.notes.push(
        "The query had no select, so every attribute is a column",
      );
    }
    m.sorts = order.map((o) => this.sort(o, columnTrees));
    return { model: m, notes: this.notes };
  }

  private src(node: LuaExpression): string {
    const { from = 0, to = 0 } = node.ctx;
    return this.text.slice(from - this.base, to - this.base);
  }

  /** The attribute path `node` reads from the object (`t.a.b` → `a.b`), or null */
  private accessPath(node: LuaExpression): string | null {
    // A nested attribute as the builder writes it: `(t.a and t.a.b)`
    if (
      node.type === "Parenthesized" &&
      node.expression.type === "Binary" &&
      node.expression.operator === "and"
    ) {
      const path = this.plainPath(node.expression.right);
      const written =
        path && parseExpressionString(attributeAccess(this.v, path));
      return written && sameTree(written, node) ? path : null;
    }
    return this.plainPath(node);
  }

  /** The attribute path of a plain `t.a.b` */
  private plainPath(node: LuaExpression): string | null {
    const segments: string[] = [];
    let n: LuaExpression = node;
    for (;;) {
      if (n.type === "PropertyAccess") {
        segments.unshift(n.property);
        n = n.object;
      } else if (n.type === "TableAccess" && n.key.type === "String") {
        segments.unshift(n.key.value);
        n = n.object;
      } else break;
    }
    if (n.type !== "Variable" || n.name !== this.v || !segments.length) {
      return null;
    }
    return segments.join(".");
  }

  /** The first attribute path read anywhere in `node` */
  private firstPath(node: unknown): string | null {
    if (!node || typeof node !== "object") return null;
    const path = "type" in node ? this.accessPath(node as LuaExpression) : null;
    if (path) return path;
    for (const [k, v] of Object.entries(node)) {
      if (k === "ctx") continue;
      const found = Array.isArray(v)
        ? v.map((x) => this.firstPath(x)).find((x) => x)
        : this.firstPath(v);
      if (found) return found;
    }
    return null;
  }

  // ---- Where

  private filters(where: LuaExpression): Filter[] {
    const conjuncts: LuaExpression[] = [];
    const split = (e: LuaExpression) => {
      if (e.type === "Binary" && e.operator === "and") {
        split(e.left);
        split(e.right);
      } else conjuncts.push(e);
    };
    split(where);
    const out: Filter[] = [];
    for (let i = 0; i < conjuncts.length; i++) {
      const c = conjuncts[i];
      // A type guard and the comparison it protects are one filter
      const next = conjuncts[i + 1];
      if (next && isTypeGuard(c)) {
        const pair: LuaExpression = {
          type: "Binary",
          operator: "and",
          left: c,
          right: next,
          ctx: c.ctx,
        };
        const f = this.attributeFilter(pair);
        if (f) {
          out.push(f);
          i++;
          continue;
        }
      }
      out.push(this.attributeFilter(c) ?? this.expressionFilter(c));
    }
    return out;
  }

  private expressionFilter(c: LuaExpression): Filter {
    // The builder adds the parentheses an or needs again
    const inner =
      c.type === "Parenthesized" &&
      c.expression.type === "Binary" &&
      c.expression.operator === "or"
        ? c.expression
        : c;
    return { kind: "expr", expr: this.src(inner) };
  }

  /** The attribute filter whose Lua is `cond`, if one is */
  private attributeFilter(cond: LuaExpression): Filter | null {
    const attribute = this.firstPath(cond);
    if (!attribute) return null;
    const type = attributeType(this.model, this.attributes, attribute);
    const access = attributeAccess(this.v, attribute);
    // The values could be any of the literals; a type guard's comes first
    const literals = literalsOf(cond);
    const candidates = [
      [],
      ...literals.map((l) => [l]),
      literals.slice(0, 2),
      literals.slice(1, 3),
      literals,
    ];
    for (const op of operatorsFor(type)) {
      for (const values of candidates) {
        const f: Filter = { kind: "attribute", attribute, op: op.id, values };
        let tree: LuaExpression;
        try {
          tree = parseExpressionString(filterLua(f, access, type));
        } catch {
          continue;
        }
        if (sameTree(tree, cond)) return f;
      }
    }
    return null;
  }

  // ---- Group By

  private groupKey(f: LuaTableField): string {
    const path = f.type === "ExpressionField" ? this.accessPath(f.value) : null;
    if (!path) refuse("The builder can only group by attributes");
    return path;
  }

  /** `key` or `key[i]`: the group key it names */
  private keyOf(node: LuaExpression): string | null {
    const g = this.model.group;
    if (node.type === "Variable" && node.name === "key") return g[0] ?? null;
    if (
      node.type === "TableAccess" &&
      node.object.type === "Variable" &&
      node.object.name === "key" &&
      node.key.type === "Number"
    ) {
      return g[node.key.value - 1] ?? null;
    }
    return null;
  }

  // ---- Select

  /** A table's entries as header and value */
  private entries(
    value: LuaExpression,
  ): { header: string; value: LuaExpression }[] {
    if (value.type !== "TableConstructor") {
      refuse("The builder can't show this select");
    }
    return value.fields.map((f) => {
      if (f.type === "PropField") return { header: f.key, value: f.value };
      if (f.type === "DynamicField" && f.key.type === "String") {
        return { header: f.key.value, value: f.value };
      }
      refuse("Every selected column needs a name");
    });
  }

  private select(value: LuaExpression): QuerySelect {
    if (value.type === "TableConstructor") {
      return {
        mode: "table",
        columns: this.entries(value).map((e) => this.column(e.header, e.value)),
      };
    }
    if (value.type === "FunctionCall" && this.isObjectArg(value)) {
      const fn = value.prefix;
      // templates.pageItem(p)
      if (
        fn.type === "PropertyAccess" &&
        fn.object.type === "Variable" &&
        fn.object.name === "templates"
      ) {
        return { mode: "list", list: { template: `templates.${fn.property}` } };
      }
      // template.new[[…]](p)
      if (
        fn.type === "FunctionCall" &&
        fn.prefix.type === "PropertyAccess" &&
        fn.prefix.object.type === "Variable" &&
        fn.prefix.object.name === "template" &&
        fn.prefix.property === "new" &&
        fn.args.length === 1 &&
        fn.args[0].type === "String"
      ) {
        return {
          mode: "list",
          list: { custom: templateText(fn.args[0].value) },
        };
      }
    }
    refuse("The builder can't show this select");
  }

  private isObjectArg(call: LuaFunctionCallExpression): boolean {
    const [arg] = call.args;
    return (
      call.args.length === 1 && arg.type === "Variable" && arg.name === this.v
    );
  }

  private column(header: string, value: LuaExpression): TableColumn {
    const id = newId();
    const path = this.accessPath(value);
    if (path) return { id, header, kind: "attribute", value: path };
    const linked = this.firstPath(value);
    if (linked) {
      const link = parseExpressionString(
        `"[[" .. ${attributeAccess(this.v, linked)} .. "]]"`,
      );
      if (sameTree(link, value)) {
        return { id, header, kind: "link", value: linked };
      }
    }
    return { id, header, kind: "expr", value: this.src(value) };
  }

  private groupColumns(
    value: LuaExpression,
    trees: Map<string, LuaExpression>,
  ): GroupColumn[] {
    return this.entries(value).map(({ header, value }) => {
      const id = newId();
      trees.set(id, value);
      const key = this.keyOf(value);
      if (key) return { id, header, kind: "key", attribute: key };
      const agg = this.aggregate(value);
      if (!agg) refuse(`The builder can't show the column ${header}`);
      return { id, header, kind: "agg", ...agg };
    });
  }

  /** `count(t.x)`, `array_agg(t.x order by t.x)`, `… filter(where …)` */
  private aggregate(node: LuaExpression): {
    agg: string;
    attribute: string;
    sorted: boolean;
    where?: string;
  } | null {
    let where: string | undefined;
    let call: LuaExpression = node;
    if (call.type === "FilteredCall") {
      where = this.src(call.filter);
      call = call.call;
    }
    let orderBy: LuaOrderBy[] | undefined;
    if (call.type === "AggregateCall") {
      orderBy = call.orderBy;
      call = call.call;
    }
    if (call.type !== "FunctionCall" || call.prefix.type !== "Variable") {
      return null;
    }
    orderBy ??= call.orderBy;
    const attribute =
      call.args.length === 1 ? this.accessPath(call.args[0]) : null;
    if (!attribute) return null;
    const agg = call.prefix.name;
    const sorted =
      !!orderBy?.length &&
      agg === "array_agg" &&
      orderBy.length === 1 &&
      orderBy[0].direction === "asc" &&
      !orderBy[0].nulls &&
      sameTree(orderBy[0].expression, call.args[0]);
    if (orderBy?.length && !sorted) return null;
    return { agg, attribute, sorted, ...(where ? { where } : {}) };
  }

  // ---- Order By

  private sort(o: LuaOrderBy, columns: Map<string, LuaExpression>): Sort {
    if (o.using) refuse("The builder can't order with using");
    const by = this.sortBy(o.expression, columns);
    return {
      by,
      desc: o.direction === "desc",
      ...(o.nulls ? { nulls: o.nulls } : {}),
    };
  }

  private sortBy(
    e: LuaExpression,
    columns: Map<string, LuaExpression>,
  ): SortBy {
    if (this.model.group.length) {
      const key = this.keyOf(e);
      if (key) return { kind: "groupKey", attribute: key };
      for (const [id, tree] of columns) {
        const c = this.model.groupColumns.find((x) => x.id === id);
        if (c?.kind === "agg" && sameTree(tree, e))
          return { kind: "column", id };
      }
    } else {
      const attribute = this.accessPath(e);
      if (attribute) return { kind: "attribute", attribute };
    }
    return { kind: "expr", lua: this.src(e) };
  }
}

/** `type(x) == "string"` or `"number"`: the guard before a comparison */
function isTypeGuard(e: LuaExpression): boolean {
  return (
    e.type === "Binary" &&
    e.operator === "==" &&
    e.left.type === "FunctionCall" &&
    e.left.prefix.type === "Variable" &&
    e.left.prefix.name === "type" &&
    e.right.type === "String" &&
    (e.right.value === "string" || e.right.value === "number")
  );
}

/** The string and number literals in `node`, in order, as filter values */
function literalsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const t = (n as { type?: string }).type;
    if (t === "String" || t === "Number") {
      out.push(String((n as { value: unknown }).value));
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "ctx") continue;
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(node);
  return out;
}

/** A custom template's text, without the layout the builder writes around it */
function templateText(s: string): string {
  const m = /^ {4}([\s\S]*)\n {2}$/.exec(s);
  return m ? m[1] : s.trim();
}
