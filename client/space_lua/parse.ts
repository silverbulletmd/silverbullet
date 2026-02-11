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

function expressionHasFunctionDef(e: LuaExpression): boolean {
  if (!e) return false;
  switch (e.type) {
    case "FunctionDefinition":
      return true;
    case "FunctionCall":
      if (expressionHasFunctionDef(e.prefix)) return true;
      for (let i = 0; i < e.args.length; i++) {
        if (expressionHasFunctionDef(e.args[i])) return true;
      }
      return false;
    case "Binary":
      return expressionHasFunctionDef(e.left) ||
        expressionHasFunctionDef(e.right);
    case "Unary":
      return expressionHasFunctionDef(e.argument);
    case "Parenthesized":
      return expressionHasFunctionDef(e.expression);
    case "TableConstructor":
      for (let i = 0; i < e.fields.length; i++) {
        const f = e.fields[i];
        switch (f.type) {
          case "DynamicField":
            if (expressionHasFunctionDef(f.key)) return true;
            if (expressionHasFunctionDef(f.value)) return true;
            break;
          case "PropField":
          case "ExpressionField":
            if (expressionHasFunctionDef(f.value)) return true;
            break;
        }
      }
      return false;
    case "TableAccess":
      return expressionHasFunctionDef(e.object) ||
        expressionHasFunctionDef(e.key);
    case "PropertyAccess":
      return expressionHasFunctionDef(e.object);
    case "Query":
      for (let i = 0; i < e.clauses.length; i++) {
        const c = e.clauses[i];
        switch (c.type) {
          case "From":
            if (expressionHasFunctionDef(c.expression)) return true;
            break;
          case "Where":
          case "Select":
            if (expressionHasFunctionDef(c.expression)) return true;
            break;
          case "Limit":
            if (expressionHasFunctionDef(c.limit)) return true;
            if (c.offset && expressionHasFunctionDef(c.offset)) return true;
            break;
          case "OrderBy":
            for (let j = 0; j < c.orderBy.length; j++) {
              if (expressionHasFunctionDef(c.orderBy[j].expression)) {
                return true;
              }
            }
            break;
        }
      }
      return false;
    default:
      return false;
  }
}

function expressionsHaveFunctionDef(
  exprs: LuaExpression[] | undefined,
): boolean {
  if (!exprs) return false;
  for (let i = 0; i < exprs.length; i++) {
    if (expressionHasFunctionDef(exprs[i])) return true;
  }
  return false;
}

// Does the expression reference any of `names`?
// Note: It DOES NOT descend into `FunctionDefinition`.
function exprReferencesNames(e: LuaExpression, names: Set<string>): boolean {
  if (!e) return false;
  switch (e.type) {
    case "Variable":
      return names.has(e.name);
    case "Binary":
      return exprReferencesNames(e.left, names) ||
        exprReferencesNames(e.right, names);
    case "Unary":
      return exprReferencesNames(e.argument, names);
    case "Parenthesized":
      return exprReferencesNames(e.expression, names);
    case "FunctionCall":
      if (exprReferencesNames(e.prefix, names)) return true;
      for (let i = 0; i < e.args.length; i++) {
        if (exprReferencesNames(e.args[i], names)) return true;
      }
      return false;
    case "TableAccess":
      return exprReferencesNames(e.object, names) ||
        exprReferencesNames(e.key, names);
    case "PropertyAccess":
      return exprReferencesNames(e.object, names);
    case "TableConstructor":
      for (let i = 0; i < e.fields.length; i++) {
        const f = e.fields[i];
        switch (f.type) {
          case "DynamicField":
            if (exprReferencesNames(f.key, names)) return true;
            if (exprReferencesNames(f.value, names)) return true;
            break;
          case "PropField":
          case "ExpressionField":
            if (exprReferencesNames(f.value, names)) return true;
            break;
        }
      }
      return false;
    case "FunctionDefinition":
      return false;
    case "Query":
      for (let i = 0; i < e.clauses.length; i++) {
        const c = e.clauses[i];
        switch (c.type) {
          case "From":
            if (exprReferencesNames(c.expression, names)) return true;
            break;
          case "Where":
          case "Select":
            if (exprReferencesNames(c.expression, names)) return true;
            break;
          case "Limit":
            if (exprReferencesNames(c.limit, names)) return true;
            if (c.offset && exprReferencesNames(c.offset, names)) return true;
            break;
          case "OrderBy":
            for (let j = 0; j < c.orderBy.length; j++) {
              if (exprReferencesNames(c.orderBy[j].expression, names)) {
                return true;
              }
            }
            break;
        }
      }
      return false;
    default:
      return false;
  }
}

function lvalueReferencesNames(lv: LuaLValue, names: Set<string>): boolean {
  switch (lv.type) {
    case "Variable":
      return names.has(lv.name);
    case "PropertyAccess":
      return exprReferencesNames(lv.object as LuaExpression, names);
    case "TableAccess":
      return exprReferencesNames(lv.object as LuaExpression, names) ||
        exprReferencesNames(lv.key, names);
  }
}

// Does a function body reference any of `names` NOT shadowed by its
// parameters?
function functionBodyCapturesNames(
  body: LuaFunctionBody,
  names: Set<string>,
): boolean {
  let unshadowed: Set<string> | null = null;
  for (let i = 0; i < body.parameters.length; i++) {
    if (names.has(body.parameters[i])) {
      if (!unshadowed) unshadowed = new Set(names);
      unshadowed.delete(body.parameters[i]);
    }
  }
  const check = unshadowed ?? names;
  if (check.size === 0) return false;
  return blockReferencesNames(body.block, check);
}

// Walk block using `exprReferencesNames` (inside a function body).
function blockReferencesNames(block: LuaBlock, names: Set<string>): boolean {
  for (let i = 0; i < block.statements.length; i++) {
    if (statementReferencesNames(block.statements[i], names)) return true;
  }
  return false;
}

function statementReferencesNames(
  s: LuaStatement,
  names: Set<string>,
): boolean {
  switch (s.type) {
    case "Local": {
      const exprs = (s as any).expressions as LuaExpression[] | undefined;
      if (exprs) {
        for (let i = 0; i < exprs.length; i++) {
          if (exprReferencesNames(exprs[i], names)) return true;
        }
      }
      return false;
    }
    case "LocalFunction": {
      const lf = s as any;
      return functionBodyCapturesNames(lf.body as LuaFunctionBody, names);
    }
    case "Function": {
      const fn = s as any;
      return functionBodyCapturesNames(fn.body as LuaFunctionBody, names);
    }
    case "FunctionCallStatement": {
      const call = (s as any).call as LuaFunctionCallExpression;
      if (exprReferencesNames(call.prefix, names)) return true;
      for (let i = 0; i < call.args.length; i++) {
        if (exprReferencesNames(call.args[i], names)) return true;
      }
      return false;
    }
    case "Assignment": {
      const a = s as any;
      const vars = a.variables as LuaLValue[];
      if (vars) {
        for (let i = 0; i < vars.length; i++) {
          if (lvalueReferencesNames(vars[i], names)) return true;
        }
      }
      const exprs = a.expressions as LuaExpression[];
      for (let i = 0; i < exprs.length; i++) {
        if (exprReferencesNames(exprs[i], names)) return true;
      }
      return false;
    }
    case "Return": {
      const exprs = (s as any).expressions as LuaExpression[];
      for (let i = 0; i < exprs.length; i++) {
        if (exprReferencesNames(exprs[i], names)) return true;
      }
      return false;
    }
    case "Block":
      return blockReferencesNames(s as LuaBlock, names);
    case "If": {
      const iff = s as LuaIfStatement;
      for (const c of iff.conditions) {
        if (exprReferencesNames(c.condition, names)) return true;
        if (blockReferencesNames(c.block, names)) return true;
      }
      if (iff.elseBlock && blockReferencesNames(iff.elseBlock, names)) {
        return true;
      }
      return false;
    }
    case "While": {
      const w = s as any;
      if (exprReferencesNames(w.condition, names)) return true;
      return blockReferencesNames(w.block as LuaBlock, names);
    }
    case "Repeat": {
      const r = s as any;
      if (blockReferencesNames(r.block as LuaBlock, names)) return true;
      if (exprReferencesNames(r.condition, names)) return true;
      return false;
    }
    case "For": {
      const fr = s as any;
      if (exprReferencesNames(fr.start, names)) return true;
      if (exprReferencesNames(fr.end, names)) return true;
      if (fr.step && exprReferencesNames(fr.step, names)) return true;
      return blockReferencesNames(fr.block as LuaBlock, names);
    }
    case "ForIn": {
      const fi = s as any;
      const exprs = fi.expressions as LuaExpression[];
      for (let i = 0; i < exprs.length; i++) {
        if (exprReferencesNames(exprs[i], names)) return true;
      }
      return blockReferencesNames(fi.block as LuaBlock, names);
    }
    default:
      return false;
  }
}

// Walk block looking for `FunctionDefinition` nodes that capture `names`.
function blockCapturesNames(block: LuaBlock, names: Set<string>): boolean {
  for (let i = 0; i < block.statements.length; i++) {
    if (statementCapturesNames(block.statements[i], names)) return true;
  }
  return false;
}

function statementCapturesNames(
  s: LuaStatement,
  names: Set<string>,
): boolean {
  switch (s.type) {
    case "Local": {
      const exprs = (s as any).expressions as LuaExpression[] | undefined;
      if (exprs) {
        for (let i = 0; i < exprs.length; i++) {
          if (exprCapturesNames(exprs[i], names)) return true;
        }
      }
      return false;
    }
    case "LocalFunction": {
      const lf = s as any;
      return functionBodyCapturesNames(lf.body as LuaFunctionBody, names);
    }
    case "Function": {
      const fn = s as any;
      return functionBodyCapturesNames(fn.body as LuaFunctionBody, names);
    }
    case "FunctionCallStatement": {
      const call = (s as any).call as LuaFunctionCallExpression;
      if (exprCapturesNames(call.prefix, names)) return true;
      for (let i = 0; i < call.args.length; i++) {
        if (exprCapturesNames(call.args[i], names)) return true;
      }
      return false;
    }
    case "Assignment": {
      const exprs = (s as any).expressions as LuaExpression[];
      for (let i = 0; i < exprs.length; i++) {
        if (exprCapturesNames(exprs[i], names)) return true;
      }
      return false;
    }
    case "Return": {
      const exprs = (s as any).expressions as LuaExpression[];
      for (let i = 0; i < exprs.length; i++) {
        if (exprCapturesNames(exprs[i], names)) return true;
      }
      return false;
    }
    case "Block":
      return blockCapturesNames(s as LuaBlock, names);
    case "If": {
      const iff = s as LuaIfStatement;
      for (const c of iff.conditions) {
        if (exprCapturesNames(c.condition, names)) return true;
        if (blockCapturesNames(c.block, names)) return true;
      }
      if (iff.elseBlock && blockCapturesNames(iff.elseBlock, names)) {
        return true;
      }
      return false;
    }
    case "While": {
      const w = s as any;
      if (exprCapturesNames(w.condition, names)) return true;
      return blockCapturesNames(w.block as LuaBlock, names);
    }
    case "Repeat": {
      const r = s as any;
      if (blockCapturesNames(r.block as LuaBlock, names)) return true;
      if (exprCapturesNames(r.condition, names)) return true;
      return false;
    }
    case "For": {
      const fr = s as any;
      if (exprCapturesNames(fr.start, names)) return true;
      if (exprCapturesNames(fr.end, names)) return true;
      if (fr.step && exprCapturesNames(fr.step, names)) return true;
      return blockCapturesNames(fr.block as LuaBlock, names);
    }
    case "ForIn": {
      const fi = s as any;
      const exprs = fi.expressions as LuaExpression[];
      for (let i = 0; i < exprs.length; i++) {
        if (exprCapturesNames(exprs[i], names)) return true;
      }
      return blockCapturesNames(fi.block as LuaBlock, names);
    }
    default:
      return false;
  }
}

// At loop block level find `FunctionDefinition` and check if it
// captures `names`.
function exprCapturesNames(e: LuaExpression, names: Set<string>): boolean {
  if (!e) return false;
  switch (e.type) {
    case "FunctionDefinition":
      return functionBodyCapturesNames(e.body, names);
    case "Binary":
      return exprCapturesNames(e.left, names) ||
        exprCapturesNames(e.right, names);
    case "Unary":
      return exprCapturesNames(e.argument, names);
    case "Parenthesized":
      return exprCapturesNames(e.expression, names);
    case "FunctionCall":
      if (exprCapturesNames(e.prefix, names)) return true;
      for (let i = 0; i < e.args.length; i++) {
        if (exprCapturesNames(e.args[i], names)) return true;
      }
      return false;
    case "TableAccess":
      return exprCapturesNames(e.object, names) ||
        exprCapturesNames(e.key, names);
    case "PropertyAccess":
      return exprCapturesNames(e.object, names);
    case "TableConstructor":
      for (let i = 0; i < e.fields.length; i++) {
        const f = e.fields[i];
        switch (f.type) {
          case "DynamicField":
            if (exprCapturesNames(f.key, names)) return true;
            if (exprCapturesNames(f.value, names)) return true;
            break;
          case "PropField":
          case "ExpressionField":
            if (exprCapturesNames(f.value, names)) return true;
            break;
        }
      }
      return false;
    case "Query":
      for (let i = 0; i < e.clauses.length; i++) {
        const c = e.clauses[i];
        switch (c.type) {
          case "From":
            if (exprCapturesNames(c.expression, names)) return true;
            break;
          case "Where":
          case "Select":
            if (exprCapturesNames(c.expression, names)) return true;
            break;
          case "Limit":
            if (exprCapturesNames(c.limit, names)) return true;
            if (c.offset && exprCapturesNames(c.offset, names)) return true;
            break;
          case "OrderBy":
            for (let j = 0; j < c.orderBy.length; j++) {
              if (exprCapturesNames(c.orderBy[j].expression, names)) {
                return true;
              }
            }
            break;
        }
      }
      return false;
    default:
      return false;
  }
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
  let hasFunctionDef = false;

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
        if (!hasFunctionDef) {
          hasFunctionDef = expressionsHaveFunctionDef(
            (s as any).expressions as LuaExpression[] | undefined,
          );
        }
        break;
      }
      case "LocalFunction": {
        hasLocalDecl = true;
        hasFunctionDef = true;
        break;
      }
      case "Function": {
        hasFunctionDef = true;
        break;
      }
      case "FunctionCallStatement": {
        if (!hasFunctionDef) {
          const call = (s as any).call as LuaFunctionCallExpression;
          hasFunctionDef = expressionHasFunctionDef(call.prefix) ||
            expressionsHaveFunctionDef(call.args);
        }
        break;
      }
      case "Assignment": {
        if (!hasFunctionDef) {
          hasFunctionDef = expressionsHaveFunctionDef(
            (s as any).expressions as LuaExpression[],
          );
        }
        break;
      }
      case "Return": {
        if (!hasFunctionDef) {
          hasFunctionDef = expressionsHaveFunctionDef(
            (s as any).expressions as LuaExpression[],
          );
        }
        break;
      }
      case "Block": {
        const child = s as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = hasCloseHere || !!child.hasCloseHere;
        hasFunctionDef = hasFunctionDef || !!child.hasFunctionDef;
        break;
      }
      case "If": {
        const iff = s as LuaIfStatement;
        for (const c of iff.conditions) {
          hasLabel = hasLabel || !!c.block.hasLabel;
          hasGoto = hasGoto || !!c.block.hasGoto;
          hasCloseHere = hasCloseHere || !!c.block.hasCloseHere;
          hasFunctionDef = hasFunctionDef || !!c.block.hasFunctionDef;
          if (!hasFunctionDef) {
            hasFunctionDef = expressionHasFunctionDef(c.condition);
          }
        }
        if (iff.elseBlock) {
          hasLabel = hasLabel || !!iff.elseBlock.hasLabel;
          hasGoto = hasGoto || !!iff.elseBlock.hasGoto;
          hasCloseHere = hasCloseHere || !!iff.elseBlock.hasCloseHere;
          hasFunctionDef = hasFunctionDef || !!iff.elseBlock.hasFunctionDef;
        }
        break;
      }
      case "While":
      case "Repeat": {
        const child = (s as any).block as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = hasCloseHere || !!child.hasCloseHere;
        hasFunctionDef = hasFunctionDef || !!child.hasFunctionDef;
        if (!hasFunctionDef) {
          hasFunctionDef = expressionHasFunctionDef((s as any).condition);
        }
        break;
      }
      case "For": {
        const child = (s as any).block as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = hasCloseHere || !!child.hasCloseHere;
        hasFunctionDef = hasFunctionDef || !!child.hasFunctionDef;
        if (!hasFunctionDef) {
          hasFunctionDef = expressionHasFunctionDef((s as any).start) ||
            expressionHasFunctionDef((s as any).end) ||
            ((s as any).step
              ? expressionHasFunctionDef((s as any).step)
              : false);
        }
        break;
      }
      case "ForIn": {
        const child = (s as any).block as LuaBlock;
        hasLabel = hasLabel || !!child.hasLabel;
        hasGoto = hasGoto || !!child.hasGoto;
        hasCloseHere = true;
        hasFunctionDef = hasFunctionDef || !!child.hasFunctionDef;
        if (!hasFunctionDef) {
          hasFunctionDef = expressionsHaveFunctionDef(
            (s as any).expressions as LuaExpression[],
          );
        }
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
  if (hasFunctionDef) {
    block.hasFunctionDef = true;
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
        const name = forNumeric.children![0].children![0].text!;
        const block = parseBlock(t.children![3], ctx);
        const node: LuaStatement = {
          type: "For",
          name,
          start: parseExpression(forNumeric.children![2], ctx),
          end: parseExpression(forNumeric.children![4], ctx),
          step: forNumeric.children![5]
            ? parseExpression(forNumeric.children![6], ctx)
            : undefined,
          block,
          ctx: context(t, ctx),
        };
        if (block.hasFunctionDef) {
          const names = new Set([name]);
          (node as any).capturesLoopVar = blockCapturesNames(block, names);
        }
        return node;
      }
      const forGeneric = t.children![1];
      const names = parseNameList(forGeneric.children![0]);
      const block = parseBlock(t.children![3], ctx);
      const node: LuaStatement = {
        type: "ForIn",
        names,
        expressions: parseExpList(forGeneric.children![2], ctx),
        block,
        ctx: context(t, ctx),
      };
      if (block.hasFunctionDef) {
        const nameSet = new Set(names);
        (node as any).capturesLoopVar = blockCapturesNames(block, nameSet);
      }
      return node;
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
