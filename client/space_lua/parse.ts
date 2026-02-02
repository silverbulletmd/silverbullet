import { lezerToParseTree } from "../../client/markdown_parser/parse_tree.ts";
import type { SyntaxNode } from "@lezer/common";
import {
  cleanTree,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parser } from "./parse-lua.js";
import { styleTags, tags as t } from "@lezer/highlight";
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
  LuaIfStatement,
  LuaLValue,
  LuaOrderBy,
  LuaPrefixExpression,
  LuaQueryClause,
  LuaStatement,
  LuaTableField,
} from "./ast.ts";
import { LuaAttribute } from "./ast.ts";
import { getBlockGotoMeta } from "./labels.ts";
import { LuaRuntimeError, LuaStackFrame } from "./runtime.ts";

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
  languageData: {
    commentTokens: { line: "--", block: { open: "--[[", close: "--]]" } },
  },
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

function hasCloseLocal(names: LuaAttName[] | undefined): boolean {
  if (!names) {
    return false;
  }
  for (const n of names) {
    if (n.attributes?.includes(LuaAttribute.Close) === true) {
      return true;
    }
  }
  return false;
}

function parseBlock(t: ParseTree, ctx: ASTCtx): LuaBlock {
  if (t.type !== "Block") {
    throw new Error(`Expected Block, got ${t.type}`);
  }
  const stmtNodes = t.children!.filter((c) => c && c.type);
  const statements = stmtNodes.map((s) => parseStatement(s, ctx));
  const block: LuaBlock = { type: "Block", statements, ctx: context(t, ctx) };

  let hasLabel = false;
  let hasGoto = false;
  let hasLocalDecl = false;
  let dup: { name: string; ctx: ASTCtx } | undefined;
  let hasLabelHere = false;
  let hasCloseHere = false;

  const seen = new Set<string>();

  for (const s of statements) {
    switch (s.type) {
      case "Label": {
        hasLabel = true;
        hasLabelHere = true;
        // Duplicate labels in the same block are illegal
        const name = (s as any).name as string;
        if (!dup) {
          if (seen.has(name)) {
            dup = { name, ctx: (s as any).ctx as ASTCtx };
          } else {
            seen.add(name);
          }
        }
        break;
      }
      case "Goto": {
        hasGoto = true;
        break;
      }
      case "Local": {
        hasLocalDecl = true;
        if (!hasCloseHere) {
          hasCloseHere = hasCloseLocal((s as any).names as LuaAttName[]);
        }
        break;
      }
      case "LocalFunction": {
        hasLocalDecl = true;
        break;
      }
      case "Block": {
        const child = s as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = hasCloseHere || !!child.hasCloseHere;
        break;
      }
      case "If": {
        const iff = s as LuaIfStatement;
        for (const c of iff.conditions) {
          hasLabel = hasLabel || !!c.block.hasLabel;
          hasGoto = hasGoto || !!c.block.hasGoto;
          hasCloseHere = hasCloseHere || !!c.block.hasCloseHere;
        }
        if (iff.elseBlock) {
          hasLabel = hasLabel || !!iff.elseBlock.hasLabel;
          hasGoto = hasGoto || !!iff.elseBlock.hasGoto;
          hasCloseHere = hasCloseHere || !!iff.elseBlock.hasCloseHere;
        }
        break;
      }
      case "While":
      case "Repeat":
      case "For": {
        const child = (s as any).block as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = hasCloseHere || !!child.hasCloseHere;
        break;
      }
      case "ForIn": {
        const child = (s as any).block as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = true;
        break;
      }
      default: {
        break;
      }
    }
  }

  if (hasLabel) {
    block.hasLabel = true;
  }
  if (hasGoto) {
    block.hasGoto = true;
  }
  if (dup) {
    block.dupLabelError = dup;
  }
  if (hasLocalDecl) {
    block.needsEnv = true;
  }
  if (hasLabelHere) {
    block.hasLabelHere = true;
  }
  if (hasCloseHere) {
    block.hasCloseHere = true;
  }

  return block;
}

function parseStatement(t: ParseTree, ctx: ASTCtx): LuaStatement {
  if (!t || !t.type) {
    return {
      type: "Semicolon",
      ctx: context(t, ctx),
    };
  }
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
        if (!child || !child.children || !child.children[0]) {
          continue;
        }
        const token = child.children![0].text;
        if (token === "if" || token === "elseif") {
          conditions.push({
            condition: parseExpression(t.children![i + 1], ctx),
            block: parseBlock(t.children![i + 3], ctx),
            from: child.from,
            to: child.to,
          });
        } else if (token === "else") {
          elseBlock = parseBlock(t.children![i + 1], ctx);
        } else if (token === "end") {
          break;
        } else {
          throw new Error(`Unknown if clause type: ${token}`);
        }
      }
      return {
        type: "If",
        conditions,
        elseBlock,
        ctx: context(t, ctx),
      };
    }
    case "ForStatement": {
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
      }
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
        variables: t.children![0].children!
          .filter((c) => c.type && c.type !== ",")
          .map((lvalue) => parseLValue(lvalue, ctx)),
        expressions: parseExpList(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "Local": {
      const names = parseAttNames(t.children![1], ctx);

      let closeCount = 0;
      for (const n of names) {
        if (n.attributes?.includes(LuaAttribute.Close) === true) {
          closeCount++;
          if (closeCount > 1) {
            throw new Error("multiple <close> variables in local list");
          }
        }
      }

      return {
        type: "Local",
        names,
        expressions: t.children![3] ? parseExpList(t.children![3], ctx) : [],
        ctx: context(t, ctx),
      };
    }
    case "ReturnStatement": {
      const expressions = t.children![1]
        ? parseExpList(t.children![1], ctx)
        : [];
      return { type: "Return", expressions, ctx: context(t, ctx) };
    }
    case "break":
      return { type: "Break", ctx: context(t, ctx) };
    default:
      // Gracefully ignore unknown empty nodes
      if (!t.children || t.children.length === 0) {
        return {
          type: "Semicolon",
          ctx: context(t, ctx),
        };
      }
      console.error(t);
      throw new Error(
        `Unknown statement type: ${
          t.children![0] && t.children![0].text
            ? t.children![0].text
            : String(t.type)
        }`,
      );
  }
}

function parseFunctionCall(
  t: ParseTree,
  ctx: ASTCtx,
): LuaFunctionCallExpression {
  if (t.children![1] && t.children![1].type === ":") {
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
  return t.children!
    .filter((c) => c.type && c.type !== ",")
    .map((att) => parseAttName(att, ctx));
}

function parseAttName(t: ParseTree, ctx: ASTCtx): LuaAttName {
  if (t.type !== "AttName") {
    throw new Error(`Expected AttName, got ${t.type}`);
  }
  const attribute = t.children![1].children![1]
    ? t.children![1].children![1].children![0].text!
    : undefined;
  if (
    attribute &&
    attribute !== LuaAttribute.Const &&
    attribute !== LuaAttribute.Close
  ) {
    throw new Error(`unknown attribute '${attribute}'`);
  }
  const attributes = attribute ? [attribute as LuaAttribute] : undefined;
  return {
    type: "AttName",
    name: t.children![0].children![0].text!,
    attribute,
    attributes,
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
  return t.children!
    .filter((c) => c.type === "Name")
    .map((c) => c.children![0].text!);
}

function parseExpList(t: ParseTree, ctx: ASTCtx): LuaExpression[] {
  if (t.type !== "ExpList") {
    throw new Error(`Expected ExpList, got ${t.type}`);
  }
  return t.children!
    .filter((c) => c.type && c.type !== ",")
    .map((e) => parseExpression(e, ctx));
}

const delimiterRegex = /^(\[=*\[)([\s\S]*)(\]=*\])$/;

// In case of quoted strings, remove the quotes and unescape the string
// In case of a [[ type ]] literal string, remove the brackets
function parseString(s: string): string {
  // Handle long strings with delimiters
  const delimiterMatch = s.match(delimiterRegex);
  if (delimiterMatch) {
    let text = delimiterMatch[2];
    // According to Lua semantics, whenever a [[ formatted string starts with a newline, that newline should be skipped
    if (text[0] === "\n") {
      text = text.slice(1);
    }
    return text;
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
  if (!t || !t.type) {
    throw new Error("Undefined expression node");
  }
  switch (t.type) {
    case "LiteralString": {
      const cleanString = parseString(t.children![0].text!);
      return {
        type: "String",
        value: cleanString,
        ctx: context(t, ctx),
      };
    }
    case "Number": {
      const text = t.children![0].text!.toLowerCase();
      return {
        type: "Number",
        // Use the integer parser fox 0x literals
        value: text.includes("x") ? parseInt(text) : parseFloat(text),
        numericType: /[\.eEpP]/.test(text) ? "float" : "int",
        ctx: context(t, ctx),
      };
    }
    case "BinaryExpression":
      return {
        type: "Binary",
        operator: t.children![1].children![0].text!,
        left: parseExpression(t.children![0], ctx),
        right: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    case "UnaryExpression": {
      const op = t.children![0].children![0].text!;
      if (op === "+") {
        const err = new Error("unexpected symbol near '+'");
        (err as any).astCtx = context(t.children![0], ctx);
        throw err;
      }
      return {
        type: "Unary",
        operator: op,
        argument: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    }
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
        fields: t.children!
          .slice(1, -1)
          .filter((c) =>
            ["FieldExp", "FieldProp", "FieldDynamic"].includes(c.type!)
          )
          .map((tf) => parseTableField(tf, ctx)),
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
      }
      return {
        type: "From",
        expression: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
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
  return ts
    .filter((t) => t.type && ![",", "(", ")"].includes(t.type))
    .map((e) => parseExpression(e, ctx));
}

function parseFunctionBody(t: ParseTree, ctx: ASTCtx): LuaFunctionBody {
  if (t.type !== "FuncBody") {
    throw new Error(`Expected FunctionBody, got ${t.type}`);
  }
  return {
    type: "FunctionBody",
    parameters: t.children![1].children!
      .filter((c) => c.type && ["Name", "Ellipsis"].includes(c.type))
      .map((c) => c.children![0].text!),
    block: parseBlock(t.children![3], ctx),
    ctx: context(t, ctx),
  };
}

function parsePrefixExpression(t: ParseTree, ctx: ASTCtx): LuaPrefixExpression {
  if (!t || !t.type) {
    throw new Error("Undefined prefix expression node");
  }
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

export function stripLuaComments(s: string): string {
  let result = "";
  let i = 0;

  while (i < s.length) {
    // Check for long string
    if (s[i] === "[") {
      let j = i + 1;
      let equalsCount = 0;
      while (s[j] === "=") {
        equalsCount++;
        j++;
      }
      if (s[j] === "[") {
        // Found long string start
        const openBracket = s.substring(i, j + 1);
        const closeBracket = "]" + "=".repeat(equalsCount) + "]";
        result += openBracket;
        i = j + 1;

        // Find matching closing bracket
        const content = s.substring(i);
        const closeIndex = content.indexOf(closeBracket);
        if (closeIndex !== -1) {
          // Copy string content verbatim, including any comment-like sequences
          result += content.substring(0, closeIndex) + closeBracket;
          i += closeIndex + closeBracket.length;
          continue;
        }
      }
    }

    // Check for single quoted string
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      result += quote;
      i++;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") {
          result += s[i] + s[i + 1];
          i += 2;
        } else {
          result += s[i];
          i++;
        }
      }
      if (i < s.length) {
        result += s[i]; // closing quote
        i++;
      }
      continue;
    }

    // Check for comments
    if (s[i] === "-" && s[i + 1] === "-") {
      // Replace the -- with spaces
      result += "  ";
      i += 2;

      // Check for long comment
      if (s[i] === "[") {
        let j = i + 1;
        let equalsCount = 0;
        while (s[j] === "=") {
          equalsCount++;
          j++;
        }
        if (s[j] === "[") {
          // Found long comment start
          const closeBracket = "]" + "=".repeat(equalsCount) + "]";
          // Replace opening bracket with spaces
          result += " ".repeat(j - i + 1);
          i = j + 1;

          // Find matching closing bracket
          const content = s.substring(i);
          const closeIndex = content.indexOf(closeBracket);
          if (closeIndex !== -1) {
            // Replace comment content and closing bracket with spaces
            result += " ".repeat(closeIndex) + " ".repeat(closeBracket.length);
            i += closeIndex + closeBracket.length;
            continue;
          }
        }
      }

      // Single line comment - replace rest of line with spaces
      while (i < s.length && s[i] !== "\n") {
        result += " ";
        i++;
      }
      continue;
    }

    result += s[i];
    i++;
  }

  return result;
}

export function parse(s: string, ctx: ASTCtx = {}): LuaBlock {
  try {
    const t = parseToAST(stripLuaComments(s));
    // console.log("Clean tree", JSON.stringify(t, null, 2));
    const result = parseChunk(t, ctx);
    // console.log("Parsed AST", JSON.stringify(result, null, 2));
    getBlockGotoMeta(result);
    return result;
  } catch (e: any) {
    if (e && typeof e === "object" && "astCtx" in e) {
      throw new LuaRuntimeError(
        e.message,
        LuaStackFrame.lostFrame.withCtx(
          (e as any).astCtx as ASTCtx,
        ),
      );
    }
    throw e;
  }
}

export function parseToAST(t: string): ParseTree {
  const tree = parser.parse(t);

  const errNode = findFirstParseError(tree.topNode);
  if (errNode) {
    const err = new Error(luaUnexpectedSymbolMessage(t, errNode.from));
    (err as any).astCtx = { from: errNode.from, to: errNode.to };
    throw err;
  }

  const n = lezerToParseTree(t, tree.topNode);
  return cleanTree(n, true);
}

function findFirstParseError(node: SyntaxNode): SyntaxNode | null {
  if (node.type.isError) {
    return node;
  }
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    const hit = findFirstParseError(ch);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function luaUnexpectedSymbolMessage(src: string, from: number): string {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  const sym = i < src.length ? src[i] : "?";
  return `unexpected symbol near '${sym}'`;
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
