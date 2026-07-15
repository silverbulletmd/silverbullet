import type {
  LuaBlock,
  LuaExpression,
  LuaOrderBy,
  LuaQueryClause,
  LuaStatement,
  LuaTableField,
} from "./ast.ts";
import { luaFormatNumber } from "./runtime.ts";

export type PrintOptions = {
  indentWidth?: number;
  quote?: "double" | "single";
  trailingComma?: boolean;
};

type ResolvedOptions = {
  indentWidth: number;
  quote: "double" | "single";
  trailingComma: boolean;
};

function resolveOptions(opts?: PrintOptions): ResolvedOptions {
  return {
    indentWidth: opts?.indentWidth ?? 2,
    quote: opts?.quote ?? "double",
    trailingComma: opts?.trailingComma ?? true,
  };
}

const RESERVED = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

function isLuaIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !RESERVED.has(s);
}

const BINARY_PREC: Record<string, number> = {
  or: 1,
  and: 2,
  "<": 3,
  ">": 3,
  "<=": 3,
  ">=": 3,
  "~=": 3,
  "==": 3,
  "|": 4,
  "~": 5, // binary bitwise xor
  "&": 6,
  "<<": 7,
  ">>": 7,
  "..": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "//": 10,
  "%": 10,
  "^": 12,
};
const UNARY_PREC = 11;
const RIGHT_ASSOC = new Set(["..", "^"]);
const ATOM_PREC = 99;

function exprPrec(e: LuaExpression): number {
  if (e.type === "Binary") return BINARY_PREC[e.operator] ?? ATOM_PREC;
  if (e.type === "Unary") return UNARY_PREC;
  return ATOM_PREC;
}

class Printer {
  constructor(private opts: ResolvedOptions) {}

  private indent(depth: number): string {
    return " ".repeat(depth * this.opts.indentWidth);
  }

  private quoteString(s: string): string {
    const q = this.opts.quote === "double" ? '"' : "'";
    let out = q;
    for (const ch of s) {
      switch (ch) {
        case "\\":
          out += "\\\\";
          break;
        case "\n":
          out += "\\n";
          break;
        case "\r":
          out += "\\r";
          break;
        case "\t":
          out += "\\t";
          break;
        case "\0":
          out += "\\0";
          break;
        default:
          out += ch === q ? `\\${ch}` : ch;
      }
    }
    return out + q;
  }

  expression(e: LuaExpression, depth = 0): string {
    switch (e.type) {
      case "Nil":
        return "nil";
      case "Boolean":
        return e.value ? "true" : "false";
      case "Number":
        return luaFormatNumber(e.value, e.numericType);
      case "String":
        return this.quoteString(e.value);
      case "Variable":
        return e.name;
      case "PropertyAccess":
        return `${this.expression(e.object, depth)}.${e.property}`;
      case "TableAccess":
        return `${this.expression(e.object, depth)}[${this.expression(e.key, depth)}]`;
      case "Parenthesized":
        return `(${this.expression(e.expression, depth)})`;
      case "Binary": {
        const p = BINARY_PREC[e.operator] ?? ATOM_PREC;
        const rightAssoc = RIGHT_ASSOC.has(e.operator);
        const left = this.operand(e.left, p, false, rightAssoc, depth);
        const right = this.operand(e.right, p, true, rightAssoc, depth);
        return `${left} ${e.operator} ${right}`;
      }
      case "Unary": {
        const arg = this.unaryOperand(e.argument, depth);
        return /^[a-z]+$/.test(e.operator)
          ? `${e.operator} ${arg}`
          : `${e.operator}${arg}`;
      }
      case "TableConstructor":
        return this.tableConstructor(e.fields, depth);
      case "FunctionDefinition":
        return (
          "function" + this.functionRest(e.body.parameters, e.body.block, depth)
        );
      case "FunctionCall":
        return this.functionCall(e, depth);
      case "Query": {
        const lines = e.clauses.map(
          (c) => this.indent(depth + 1) + this.queryClause(c, depth + 1),
        );
        return `query[[\n${lines.join("\n")}\n${this.indent(depth)}]]`;
      }
      case "FilteredCall":
        return `${this.expression(e.call, depth)} filter ${this.expression(
          e.filter,
          depth,
        )}`;
      case "AggregateCall":
        return `${this.expression(e.call, depth)} order by ${this.orderByList(
          e.orderBy,
          depth,
        )}`;
      default:
        throw new Error(
          `pretty_print: unsupported expression type: ${(e as any).type}`,
        );
    }
  }

  private operand(
    e: LuaExpression,
    parentPrec: number,
    isRight: boolean,
    parentRightAssoc: boolean,
    depth: number,
  ): string {
    const cp = exprPrec(e);
    let parens = false;
    if (cp < parentPrec) {
      parens = true;
    } else if (cp === parentPrec) {
      // left-assoc parent: the right child of equal precedence needs parens.
      // right-assoc parent: the left child of equal precedence needs parens.
      parens = parentRightAssoc ? !isRight : isRight;
    }
    const s = this.expression(e, depth);
    return parens ? `(${s})` : s;
  }

  private unaryOperand(e: LuaExpression, depth: number): string {
    const s = this.expression(e, depth);
    return exprPrec(e) < UNARY_PREC ? `(${s})` : s;
  }

  private field(f: LuaTableField, depth: number): string {
    switch (f.type) {
      case "PropField":
        return isLuaIdentifier(f.key)
          ? `${f.key} = ${this.expression(f.value, depth)}`
          : `[${this.quoteString(f.key)}] = ${this.expression(f.value, depth)}`;
      case "DynamicField":
        return `[${this.expression(f.key, depth)}] = ${this.expression(f.value, depth)}`;
      case "ExpressionField":
        return this.expression(f.value, depth);
    }
  }

  private tableConstructor(fields: LuaTableField[], depth: number): string {
    if (fields.length === 0) return "{}";
    if (fields.length === 1) return `{${this.field(fields[0], depth)}}`;
    const lines = fields.map(
      (f) => this.indent(depth + 1) + this.field(f, depth + 1),
    );
    const tail = this.opts.trailingComma ? "," : "";
    return `{\n${lines.join(",\n")}${tail}\n${this.indent(depth)}}`;
  }

  // returns the part of a function after the `function` keyword (+ optional
  // name): "(params) end"  or  "(params)\n  <body>\nend"
  private functionRest(
    params: string[],
    body: LuaBlock,
    depth: number,
  ): string {
    const head = `(${params.join(", ")})`;
    const rendered = this.block(body, depth + 1);
    if (!rendered) return `${head} end`;
    return `${head}\n${rendered}\n${this.indent(depth)}end`;
  }

  private functionCall(
    e: Extract<LuaExpression, { type: "FunctionCall" }>,
    depth: number,
  ): string {
    let base = this.expression(e.prefix, depth);
    if (e.name) base += `:${e.name}`;
    const args = e.args;
    const orderBy = e.orderBy
      ? ` order by ${this.orderByList(e.orderBy, depth)}`
      : "";
    if (
      !e.orderBy &&
      args.length === 1 &&
      (args[0].type === "TableConstructor" || args[0].type === "String")
    ) {
      return `${base} ${this.expression(args[0], depth)}`;
    }
    return `${base}(${args.map((a) => this.expression(a, depth)).join(", ")})${orderBy}`;
  }

  private fieldList(fields: LuaTableField[], depth: number): string {
    return fields.map((f) => this.field(f, depth)).join(", ");
  }

  private orderByList(orders: LuaOrderBy[], depth: number): string {
    return orders
      .map((o) => {
        let s = this.expression(o.expression, depth);
        if (o.direction === "desc") s += " desc";
        if (o.nulls) s += ` nulls ${o.nulls}`;
        return s;
      })
      .join(", ");
  }

  private queryClause(c: LuaQueryClause, depth: number): string {
    switch (c.type) {
      case "From":
        return `from ${this.fieldList(c.fields, depth)}`;
      case "Where":
        return `where ${this.expression(c.expression, depth)}`;
      case "Limit":
        return (
          `limit ${this.expression(c.limit, depth)}` +
          (c.offset ? ` offset ${this.expression(c.offset, depth)}` : "")
        );
      case "Offset":
        return `offset ${this.expression(c.offset, depth)}`;
      case "OrderBy":
        return `order by ${this.orderByList(c.orderBy, depth)}`;
      case "Select":
        return `select ${this.fieldList(c.fields, depth)}`;
      case "GroupBy":
        return `group by ${this.fieldList(c.fields, depth)}`;
      case "Having":
        return `having ${this.expression(c.expression, depth)}`;
    }
  }

  block(b: LuaBlock, depth: number): string {
    const stmts = b.statements.filter((s) => s.type !== "Semicolon");
    const items: (LuaStatement | NonNullable<LuaBlock["comments"]>[number])[] =
      [...stmts, ...(b.comments ?? [])].sort(
        (a, z) => (a.ctx.from ?? 0) - (z.ctx.from ?? 0),
      );
    const isDef = (s: (typeof items)[number]) =>
      s.type === "Function" || s.type === "LocalFunction";
    let out = "";
    for (let i = 0; i < items.length; i++) {
      if (i > 0) {
        out += "\n";
        // blank line separating function definitions from neighbours
        const previous = items[i - 1];
        const isDocumentationPair =
          previous.type === "Comment" &&
          previous.text.startsWith("---") &&
          isDef(items[i]);
        if (!isDocumentationPair && (isDef(previous) || isDef(items[i]))) {
          out += "\n";
        }
      }
      const item = items[i];
      out +=
        item.type === "Comment"
          ? this.indent(depth) +
            item.text.replaceAll("\n", `\n${this.indent(depth)}`)
          : this.statement(item, depth);
    }
    return out;
  }

  private statement(s: LuaStatement, depth: number): string {
    const ind = this.indent(depth);
    switch (s.type) {
      case "Local": {
        const names = s.names
          .map(
            (n) =>
              n.name +
              (n.attribute
                ? ` <${n.attribute}>`
                : n.attributes?.length
                  ? ` <${n.attributes[0]}>`
                  : ""),
          )
          .join(", ");
        const exprs = s.expressions?.length
          ? ` = ${s.expressions.map((e) => this.expression(e, depth)).join(", ")}`
          : "";
        return `${ind}local ${names}${exprs}`;
      }
      case "Assignment":
        return `${ind}${s.variables
          .map((v) => this.expression(v, depth))
          .join(
            ", ",
          )} = ${s.expressions.map((e) => this.expression(e, depth)).join(", ")}`;
      case "Return":
        return s.expressions.length
          ? `${ind}return ${s.expressions
              .map((e) => this.expression(e, depth))
              .join(", ")}`
          : `${ind}return`;
      case "FunctionCallStatement":
        return ind + this.expression(s.call, depth);
      case "Break":
        return `${ind}break`;
      case "Goto":
        return `${ind}goto ${s.name}`;
      case "Label":
        return `${ind}::${s.name}::`;
      case "Block": {
        const body = this.block(s, depth + 1);
        return body ? `${ind}do\n${body}\n${ind}end` : `${ind}do end`;
      }
      case "If": {
        let out = "";
        s.conditions.forEach((c, i) => {
          const kw = i === 0 ? "if" : "elseif";
          const head = i === 0 ? `${ind}${kw} ` : `\n${ind}${kw} `;
          const body = this.block(c.block, depth + 1);
          out +=
            `${head}${this.expression(c.condition, depth)} then` +
            (body ? `\n${body}` : "");
        });
        if (s.elseBlock) {
          const body = this.block(s.elseBlock, depth + 1);
          out += `\n${ind}else${body ? `\n${body}` : ""}`;
        }
        out += `\n${ind}end`;
        return out;
      }
      case "While": {
        const body = this.block(s.block, depth + 1);
        return (
          `${ind}while ${this.expression(s.condition, depth)} do` +
          (body ? `\n${body}` : "") +
          `\n${ind}end`
        );
      }
      case "Repeat": {
        const body = this.block(s.block, depth + 1);
        return (
          `${ind}repeat` +
          (body ? `\n${body}` : "") +
          `\n${ind}until ${this.expression(s.condition, depth)}`
        );
      }
      case "For": {
        const step = s.step ? `, ${this.expression(s.step, depth)}` : "";
        const body = this.block(s.block, depth + 1);
        return `${ind}for ${s.name} = ${this.expression(s.start, depth)}, ${this.expression(
          s.end,
          depth,
        )}${step} do${body ? `\n${body}` : ""}\n${ind}end`;
      }
      case "ForIn": {
        const body = this.block(s.block, depth + 1);
        return `${ind}for ${s.names.join(", ")} in ${s.expressions
          .map((e) => this.expression(e, depth))
          .join(", ")} do${body ? `\n${body}` : ""}\n${ind}end`;
      }
      case "Function": {
        const name =
          s.name.propNames.join(".") +
          (s.name.colonName ? `:${s.name.colonName}` : "");
        return (
          `${ind}function ${name}` +
          this.functionRest(s.body.parameters, s.body.block, depth)
        );
      }
      case "LocalFunction":
        return (
          `${ind}local function ${s.name}` +
          this.functionRest(s.body.parameters, s.body.block, depth)
        );
      default:
        throw new Error(
          `pretty_print: unsupported statement type: ${(s as any).type}`,
        );
    }
  }
}

export function prettyPrintExpression(
  expr: LuaExpression,
  opts?: PrintOptions,
): string {
  return new Printer(resolveOptions(opts)).expression(expr, 0);
}

export function prettyPrintBlock(block: LuaBlock, opts?: PrintOptions): string {
  return new Printer(resolveOptions(opts)).block(block, 0);
}
