import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";
import {
  cleanTree,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parser } from "./parse-lua.js";
import { styleTags } from "@lezer/highlight";
import { indentNodeProp, LRLanguage } from "@codemirror/language";
import type {
  ASTCtx,
  LuaAttName,
  LuaBlock,
  LuaExpression,
  LuaFunctionBody,
  LuaFunctionCallExpression,
  LuaFunctionCallStatement,
  LuaFunctionName,
  LuaLValue,
  LuaOrderBy,
  LuaPrefixExpression,
  LuaQueryClause,
  LuaStatement,
  LuaTableField,
} from "./ast.ts";
import { tags as t } from "@lezer/highlight";

const luaStyleTags = styleTags({
  Name: t.variableName,
  LiteralString: t.string,
  Number: t.number,
  CompareOp: t.operator,
  "true false": t.bool,
  Comment: t.lineComment,
  "return break goto do end while repeat until function local if then else elseif in for nil or and not query from where limit select order by desc":
    t.keyword,
});

const customIndent = indentNodeProp.add({
  "IfStatement FuncBody WhileStatement ForStatement TableConstructor": (
    context,
  ) => {
    return context.lineIndent(context.node.from) + context.unit;
  },
});

// Use the customIndent in your language support
export const luaLanguage = LRLanguage.define({
  name: "space-lua",
  parser: parser.configure({
    props: [
      luaStyleTags,
      customIndent,
    ],
  }),
});

function context(t: ParseTree, ctx: Record<string, any>): ASTCtx {
  return { ...ctx, from: t.from, to: t.to };
}

function parseChunk(t: ParseTree, ctx: ASTCtx): LuaBlock {
  if (t.type !== "Chunk") {
    throw new Error(`Expected Chunk, got ${t.type}`);
  }
  return parseBlock(t.children![0], ctx);
}

function parseBlock(t: ParseTree, ctx: ASTCtx): LuaBlock {
  if (t.type !== "Block") {
    throw new Error(`Expected Block, got ${t.type}`);
  }
  const statements = t.children!.map((s) => parseStatement(s, ctx));
  return { type: "Block", statements, ctx: context(t, ctx) };
}

function parseStatement(t: ParseTree, ctx: ASTCtx): LuaStatement {
  switch (t.type) {
    case "Block":
      return parseChunk(t.children![0], ctx);
    case "Semicolon":
      return { type: "Semicolon", ctx: context(t, ctx) };
    case "Label":
      return {
        type: "Label",
        name: t.children![1].children![0].text!,
        ctx: context(t, ctx),
      };
    case "Break":
      return { type: "Break", ctx: context(t, ctx) };
    case "Goto":
      return {
        type: "Goto",
        name: t.children![1].children![0].text!,
        ctx: context(t, ctx),
      };
    case "Scope":
      return parseBlock(t.children![1], ctx);
    case ";":
      return { type: "Semicolon", ctx: context(t, ctx) };
    case "WhileStatement":
      return {
        type: "While",
        condition: parseExpression(t.children![1], ctx),
        block: parseBlock(t.children![3], ctx),
        ctx: context(t, ctx),
      };
    case "RepeatStatement":
      return {
        type: "Repeat",
        block: parseBlock(t.children![1], ctx),
        condition: parseExpression(t.children![3], ctx),
        ctx: context(t, ctx),
      };
    case "IfStatement": {
      const conditions: {
        condition: LuaExpression;
        block: LuaBlock;
        from?: number;
        to?: number;
      }[] = [];
      let elseBlock: LuaBlock | undefined = undefined;
      for (let i = 0; i < t.children!.length; i += 4) {
        const child = t.children![i];
        if (
          child.children![0].text === "if" ||
          child.children![0].text === "elseif"
        ) {
          conditions.push({
            condition: parseExpression(t.children![i + 1], ctx),
            block: parseBlock(t.children![i + 3], ctx),
            from: child.from,
            to: child.to,
          });
        } else if (child.children![0].text === "else") {
          elseBlock = parseBlock(t.children![i + 1], ctx);
        } else if (child.children![0].text === "end") {
          break;
        } else {
          throw new Error(
            `Unknown if clause type: ${child.children![0].text}`,
          );
        }
      }
      return {
        type: "If",
        conditions,
        elseBlock,
        ctx: context(t, ctx),
      };
    }
    case "ForStatement":
      if (t.children![1].type === "ForNumeric") {
        const forNumeric = t.children![1];
        return {
          type: "For",
          name: forNumeric.children![0].children![0].text!,
          start: parseExpression(forNumeric.children![2], ctx),
          end: parseExpression(forNumeric.children![4], ctx),
          step: forNumeric.children![5]
            ? parseExpression(forNumeric.children![6], ctx)
            : undefined,
          block: parseBlock(t.children![3], ctx),
          ctx: context(t, ctx),
        };
      } else {
        const forGeneric = t.children![1];
        return {
          type: "ForIn",
          names: parseNameList(forGeneric.children![0]),
          expressions: parseExpList(forGeneric.children![2], ctx),
          block: parseBlock(t.children![3], ctx),
          ctx: context(t, ctx),
        };
      }
    case "Function":
      return {
        type: "Function",
        name: parseFunctionName(t.children![1], ctx),
        body: parseFunctionBody(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "LocalFunction":
      return {
        type: "LocalFunction",
        name: t.children![2].children![0].text!,
        body: parseFunctionBody(t.children![3], ctx),
        ctx: context(t, ctx),
      };
    case "FunctionCall":
      return {
        type: "FunctionCallStatement",
        call: parseFunctionCall(t, ctx),
        ctx: context(t, ctx),
      };
    case "Assign":
      return {
        type: "Assignment",
        variables: t.children![0].children!.filter((t) => t.type !== ",").map(
          (lvalue) => parseLValue(lvalue, ctx),
        ),
        expressions: parseExpList(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "Local":
      return {
        type: "Local",
        names: parseAttNames(t.children![1], ctx),
        expressions: t.children![3] ? parseExpList(t.children![3], ctx) : [],
        ctx: context(t, ctx),
      };
    case "ReturnStatement": {
      const expressions = t.children![1]
        ? parseExpList(t.children![1], ctx)
        : [];
      return { type: "Return", expressions, ctx: context(t, ctx) };
    }
    case "break":
      return { type: "Break", ctx: context(t, ctx) };
    default:
      console.error(t);
      throw new Error(`Unknown statement type: ${t.children![0].text}`);
  }
}

function parseFunctionCall(
  t: ParseTree,
  ctx: ASTCtx,
): LuaFunctionCallExpression {
  if (t.children![1].type === ":") {
    return {
      type: "FunctionCall",
      prefix: parsePrefixExpression(t.children![0], ctx),
      name: t.children![2].children![0].text!,
      args: parseFunctionArgs(t.children!.slice(3), ctx),
      ctx: context(t, ctx),
    };
  }
  return {
    type: "FunctionCall",
    prefix: parsePrefixExpression(t.children![0], ctx),
    args: parseFunctionArgs(t.children!.slice(1), ctx),
    ctx: context(t, ctx),
  };
}

function parseAttNames(t: ParseTree, ctx: ASTCtx): LuaAttName[] {
  if (t.type !== "AttNameList") {
    throw new Error(`Expected AttNameList, got ${t.type}`);
  }
  return t.children!.filter((t) => t.type !== ",").map((att) =>
    parseAttName(att, ctx)
  );
}

function parseAttName(t: ParseTree, ctx: ASTCtx): LuaAttName {
  if (t.type !== "AttName") {
    throw new Error(`Expected AttName, got ${t.type}`);
  }
  return {
    type: "AttName",
    name: t.children![0].children![0].text!,
    attribute: t.children![1].children![1]
      ? t.children![1].children![1].children![0].text!
      : undefined,
    ctx: context(t, ctx),
  };
}

function parseLValue(t: ParseTree, ctx: ASTCtx): LuaLValue {
  switch (t.type) {
    case "Name":
      return {
        type: "Variable",
        name: t.children![0].text!,
        ctx: context(t, ctx),
      };
    case "Property":
      return {
        type: "PropertyAccess",
        object: parsePrefixExpression(t.children![0], ctx),
        property: t.children![2].children![0].text!,
        ctx: context(t, ctx),
      };
    case "MemberExpression":
      return {
        type: "TableAccess",
        object: parsePrefixExpression(t.children![0], ctx),
        key: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    default:
      console.error(t);
      throw new Error(`Unknown lvalue type: ${t.type}`);
  }
}

function parseFunctionName(t: ParseTree, ctx: ASTCtx): LuaFunctionName {
  if (t.type !== "FuncName") {
    throw new Error(`Expected FunctionName, got ${t.type}`);
  }
  const propNames: string[] = [];
  let colonName: string | undefined = undefined;
  for (let i = 0; i < t.children!.length; i += 2) {
    const prop = t.children![i];
    propNames.push(prop.children![0].text!);
    if (t.children![i + 1] && t.children![i + 1].type === ":") {
      colonName = t.children![i + 2].children![0].text!;
      break;
    }
  }
  return {
    type: "FunctionName",
    propNames,
    colonName,
    ctx: context(t, ctx),
  };
}

function parseNameList(t: ParseTree): string[] {
  if (t.type !== "NameList") {
    throw new Error(`Expected NameList, got ${t.type}`);
  }
  return t.children!.filter((t) => t.type === "Name").map((t) =>
    t.children![0].text!
  );
}

function parseExpList(t: ParseTree, ctx: ASTCtx): LuaExpression[] {
  if (t.type !== "ExpList") {
    throw new Error(`Expected ExpList, got ${t.type}`);
  }
  return t.children!.filter((t) => t.type !== ",").map((e) =>
    parseExpression(e, ctx)
  );
}

const delimiterRegex = /^(\[=*\[)([\s\S]*)(\]=*\])$/;

// In case of quoted strings, remove the quotes and unescape the string
// In case of a [[ type ]] literal string, remove the brackets
function parseString(s: string): string {
  // Handle long strings with delimiters
  const delimiterMatch = s.match(delimiterRegex);
  if (delimiterMatch) {
    return delimiterMatch[2];
  }
  return s.slice(1, -1).replace(
    /\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|[abfnrtv\\'"n])/g,
    (match, capture) => {
      switch (capture) {
        case "a":
          return "\x07"; // Bell
        case "b":
          return "\b"; // Backspace
        case "f":
          return "\f"; // Form feed
        case "n":
          return "\n"; // Newline
        case "r":
          return "\r"; // Carriage return
        case "t":
          return "\t"; // Horizontal tab
        case "v":
          return "\v"; // Vertical tab
        case "\\":
          return "\\"; // Backslash
        case '"':
          return '"'; // Double quote
        case "'":
          return "'"; // Single quote
        default:
          // Handle hexadecimal \x00
          if (capture.startsWith("x")) {
            return String.fromCharCode(parseInt(capture.slice(1), 16));
          }
          // Handle unicode \u{XXXX}
          if (capture.startsWith("u{")) {
            const codePoint = parseInt(capture.slice(2, -1), 16);
            return String.fromCodePoint(codePoint);
          }
          return match; // return the original match if nothing fits
      }
    },
  );
}

function parseExpression(t: ParseTree, ctx: ASTCtx): LuaExpression {
  switch (t.type) {
    case "LiteralString": {
      const cleanString = parseString(t.children![0].text!);
      return {
        type: "String",
        value: cleanString,
        ctx: context(t, ctx),
      };
    }
    case "Number":
      return {
        type: "Number",
        value: parseFloat(t.children![0].text!),
        ctx: context(t, ctx),
      };
    case "BinaryExpression":
      return {
        type: "Binary",
        operator: t.children![1].children![0].text!,
        left: parseExpression(t.children![0], ctx),
        right: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "UnaryExpression":
      return {
        type: "Unary",
        operator: t.children![0].children![0].text!,
        argument: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    case "Property":
      return {
        type: "PropertyAccess",
        object: parsePrefixExpression(t.children![0], ctx),
        property: t.children![2].children![0].text!,
        ctx: context(t, ctx),
      };

    case "MemberExpression":
      return {
        type: "TableAccess",
        object: parsePrefixExpression(t.children![0], ctx),
        key: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };

    case "Parens":
      return parseExpression(t.children![1], ctx);
    case "FunctionCall": {
      return parseFunctionCall(t, ctx);
    }
    case "FunctionDef": {
      const body = parseFunctionBody(t.children![1], ctx);
      return {
        type: "FunctionDefinition",
        body,
        ctx: context(t, ctx),
      };
    }
    case "Name":
      return {
        type: "Variable",
        name: t.children![0].text!,
        ctx: context(t, ctx),
      };
    case "Ellipsis":
      return { type: "Variable", name: "...", ctx: context(t, ctx) };
    case "true":
      return { type: "Boolean", value: true, ctx: context(t, ctx) };
    case "false":
      return { type: "Boolean", value: false, ctx: context(t, ctx) };
    case "TableConstructor":
      return {
        type: "TableConstructor",
        fields: t.children!.slice(1, -1).filter((t) =>
          ["FieldExp", "FieldProp", "FieldDynamic"].includes(t.type!)
        ).map((tf) => parseTableField(tf, ctx)),
        ctx: context(t, ctx),
      };
    case "nil":
      return { type: "Nil", ctx: context(t, ctx) };
    case "Query":
      return {
        type: "Query",
        clauses: t.children!.slice(2, -1).map((c) => parseQueryClause(c, ctx)),
        ctx: context(t, ctx),
      };
    default:
      console.error(t);
      throw new Error(`Unknown expression type: ${t.type}`);
  }
}

function parseQueryClause(t: ParseTree, ctx: ASTCtx): LuaQueryClause {
  if (t.type !== "QueryClause") {
    throw new Error(`Expected QueryClause, got ${t.type}`);
  }
  t = t.children![0];
  switch (t.type) {
    case "FromClause": {
      if (t.children!.length === 4) {
        // From clause with a name
        return {
          type: "From",
          name: t.children![1].children![0].text!,
          expression: parseExpression(t.children![3], ctx),
          ctx: context(t, ctx),
        };
      } else {
        return {
          type: "From",
          expression: parseExpression(t.children![1], ctx),
          ctx: context(t, ctx),
        };
      }
    }
    case "WhereClause":
      return {
        type: "Where",
        expression: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    case "LimitClause": {
      const limit = parseExpression(t.children![1], ctx);
      const offset = t.children![2]
        ? parseExpression(t.children![3], ctx)
        : undefined;
      return {
        type: "Limit",
        limit,
        offset,
        ctx: context(t, ctx),
      };
    }
    case "OrderByClause": {
      const orderBy: LuaOrderBy[] = [];
      for (const child of t.children!) {
        if (child.type === "OrderBy") {
          orderBy.push({
            type: "Order",
            expression: parseExpression(child.children![0], ctx),
            direction: child.children![1]?.type === "desc" ? "desc" : "asc",
            ctx: context(child, ctx),
          });
        }
      }
      return {
        type: "OrderBy",
        orderBy,
        ctx: context(t, ctx),
      };
    }
    case "SelectClause": {
      return {
        type: "Select",
        expression: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    }
    default:
      console.error(t);
      throw new Error(`Unknown query clause type: ${t.type}`);
  }
}

function parseFunctionArgs(ts: ParseTree[], ctx: ASTCtx): LuaExpression[] {
  return ts.filter((t) => ![",", "(", ")"].includes(t.type!)).map(
    (e) => parseExpression(e, ctx),
  );
}

function parseFunctionBody(t: ParseTree, ctx: ASTCtx): LuaFunctionBody {
  if (t.type !== "FuncBody") {
    throw new Error(`Expected FunctionBody, got ${t.type}`);
  }
  return {
    type: "FunctionBody",
    parameters: t.children![1].children!.filter((t) =>
      ["Name", "Ellipsis"].includes(t.type!)
    )
      .map((t) => t.children![0].text!),
    block: parseBlock(t.children![3], ctx),
    ctx: context(t, ctx),
  };
}

function parsePrefixExpression(t: ParseTree, ctx: ASTCtx): LuaPrefixExpression {
  switch (t.type) {
    case "Name":
      return {
        type: "Variable",
        name: t.children![0].text!,
        ctx: context(t, ctx),
      };
    case "Property":
      return {
        type: "PropertyAccess",
        object: parsePrefixExpression(t.children![0], ctx),
        property: t.children![2].children![0].text!,
        ctx: context(t, ctx),
      };
    case "MemberExpression":
      return {
        type: "TableAccess",
        object: parsePrefixExpression(t.children![0], ctx),
        key: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "Parens":
      return {
        type: "Parenthesized",
        expression: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    case "FunctionCall": {
      return parseFunctionCall(t, ctx);
    }
    default:
      console.error(t);
      throw new Error(`Unknown prefix expression type: ${t.type}`);
  }
}

function parseTableField(t: ParseTree, ctx: ASTCtx): LuaTableField {
  switch (t.type) {
    case "FieldExp":
      return {
        type: "ExpressionField",
        value: parseExpression(t.children![0], ctx),
        ctx: context(t, ctx),
      };
    case "FieldProp":
      return {
        type: "PropField",
        key: t.children![0].children![0].text!,
        value: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "FieldDynamic":
      return {
        type: "DynamicField",
        key: parseExpression(t.children![1], ctx),
        value: parseExpression(t.children![4], ctx),
        ctx: context(t, ctx),
      };
    default:
      console.error(t);
      throw new Error(`Unknown table field type: ${t.type}`);
  }
}
function stripLuaComments(s: string): string {
  // Strips Lua comments (single-line and multi-line) and replaces them with equivalent length whitespace
  let result = "";
  let inString = false;
  let inMultilineString = false;
  let inComment = false;
  let inMultilineComment = false;

  for (let i = 0; i < s.length; i++) {
    // Handle string detection for single-line strings (to avoid stripping comments inside strings)
    if (
      s[i] === '"' && !inComment && !inMultilineComment && !inMultilineString
    ) {
      inString = !inString;
    }

    // Handle multi-line string literals (starting with "[[")
    if (
      !inString && !inComment && !inMultilineComment && s[i] === "[" &&
      s[i + 1] === "["
    ) {
      inMultilineString = true;
      result += "[["; // Copy "[[" into result
      i += 1; // Skip over "[["
      continue;
    }

    // Handle end of multi-line string literals (ending with "]]")
    if (inMultilineString && s[i] === "]" && s[i + 1] === "]") {
      inMultilineString = false;
      result += "]]"; // Copy "]]" into result
      i += 1; // Skip over "]]"
      continue;
    }

    // Handle single-line comments (starting with "--")
    if (
      !inString && !inMultilineString && !inMultilineComment && s[i] === "-" &&
      s[i + 1] === "-"
    ) {
      if (s[i + 2] === "[" && s[i + 3] === "[") {
        // Detect multi-line comment start "--[["
        inMultilineComment = true;
        i += 3; // Skip over "--[["
        result += "    "; // Add equivalent length spaces for "--[["
        continue;
      } else {
        inComment = true;
      }
    }

    // Handle end of single-line comment
    if (inComment && s[i] === "\n") {
      inComment = false;
    }

    // Handle multi-line comment ending "]]"
    if (inMultilineComment && s[i] === "]" && s[i + 1] === "]") {
      inMultilineComment = false;
      i += 1; // Skip over "]]"
      result += "  "; // Add equivalent length spaces for "]]"
      continue;
    }

    // Replace comment content with spaces, or copy original content if not in comment or multi-line string
    if (inComment || inMultilineComment) {
      result += " "; // Replace comment characters with spaces
    } else {
      result += s[i];
    }
  }

  return result;
}

export function parse(s: string, ctx: ASTCtx = {}): LuaBlock {
  const t = parseToCrudeAST(stripLuaComments(s));
  // console.log("Clean tree", JSON.stringify(t, null, 2));
  const result = parseChunk(t, ctx);
  // console.log("Parsed AST", JSON.stringify(result, null, 2));
  return result;
}

export function parseToCrudeAST(t: string): ParseTree {
  const n = lezerToParseTree(t, parser.parse(t).topNode);
  return cleanTree(n, true);
}

/**
 * Helper function to parse a Lua expression string
 */
export function parseExpressionString(
  expr: string,
): LuaExpression {
  const parsedLua = parse(`_(${expr})`) as LuaBlock;
  return (parsedLua.statements[0] as LuaFunctionCallStatement).call.args[0];
}
