import { lezerToParseTree } from "../../client/markdown_parser/parse_tree.ts";
import type { SyntaxNode } from "@lezer/common";
import {
  cleanTree,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
// @ts-expect-error - Local generated JavaScript file without type definitions
import { parser } from "./parse-lua.js";
import { styleTags, tags as t } from "@lezer/highlight";
import { indentNodeProp, LRLanguage } from "@codemirror/language";
import type {
  ASTCtx,
  LuaAttName,
  LuaBlock,
  LuaExpression,
  LuaFromField,
  LuaFunctionBody,
  LuaFunctionCallExpression,
  LuaFunctionCallStatement,
  LuaFunctionName,
  LuaIfStatement,
  LuaJoinHint,
  LuaLValue,
  LuaOrderBy,
  LuaOrderBySelectKeyExpression,
  LuaPrefixExpression,
  LuaQueryClause,
  LuaStatement,
  LuaTableField,
  LuaWithHints,
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
  "return break goto do end while repeat until function local if then else elseif in for nil or and not query from materialized with rows width cost where limit offset select order by desc asc nulls first last group having filter using leading inner semi anti hash loop merge all distinct explain analyze costs summary timing verbose hints":
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
    props: [luaStyleTags, customIndent],
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
      return (
        expressionHasFunctionDef(e.left) || expressionHasFunctionDef(e.right)
      );
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
      return (
        expressionHasFunctionDef(e.object) || expressionHasFunctionDef(e.key)
      );
    case "PropertyAccess":
      return expressionHasFunctionDef(e.object);
    case "Query":
      for (let i = 0; i < e.clauses.length; i++) {
        const c = e.clauses[i];
        switch (c.type) {
          case "From":
          case "Select":
          case "GroupBy":
          case "Leading":
            for (const f of c.fields) {
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
            break;
          case "Where":
          case "Having":
            if (expressionHasFunctionDef(c.expression)) return true;
            break;
          case "Limit":
            if (expressionHasFunctionDef(c.limit)) return true;
            if (c.offset && expressionHasFunctionDef(c.offset)) return true;
            break;
          case "OrderBy":
            for (let j = 0; j < c.orderBy.length; j++) {
              const e = c.orderBy[j].expression;
              if (e && expressionHasFunctionDef(e)) {
                return true;
              }
              if (
                c.orderBy[j].using &&
                typeof c.orderBy[j].using !== "string"
              ) {
                return true;
              }
            }
            break;
          case "Explain":
            break;
        }
      }
      return false;
    case "FilteredCall":
      return (
        expressionHasFunctionDef(e.call) || expressionHasFunctionDef(e.filter)
      );
    case "AggregateCall":
      return (
        expressionHasFunctionDef((e as any).call) ||
        ((e as any).orderBy as LuaOrderBy[]).some(
          (ob) =>
            (ob.expression !== undefined &&
              expressionHasFunctionDef(ob.expression)) ||
            (ob.using && typeof ob.using !== "string"),
        )
      );
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
      return (
        exprReferencesNames(e.left, names) ||
        exprReferencesNames(e.right, names)
      );
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
      return (
        exprReferencesNames(e.object, names) ||
        exprReferencesNames(e.key, names)
      );
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
          case "Select":
          case "GroupBy":
          case "Leading":
            for (const f of c.fields) {
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
            break;
          case "Where":
          case "Having":
            if (exprReferencesNames(c.expression, names)) return true;
            break;
          case "Limit":
            if (exprReferencesNames(c.limit, names)) return true;
            if (c.offset && exprReferencesNames(c.offset, names)) return true;
            break;
          case "OrderBy":
            for (let j = 0; j < c.orderBy.length; j++) {
              const e = c.orderBy[j].expression;
              if (e && exprReferencesNames(e, names)) {
                return true;
              }
              if (
                typeof c.orderBy[j].using === "string" &&
                names.has(c.orderBy[j].using as string)
              ) {
                return true;
              }
            }
            break;
          case "Explain":
            break;
        }
      }
      return false;
    case "FilteredCall":
      return (
        exprReferencesNames(e.call, names) ||
        exprReferencesNames(e.filter, names)
      );
    case "AggregateCall": {
      const ac = e as any;
      if (exprReferencesNames(ac.call, names)) return true;
      for (const ob of ac.orderBy as LuaOrderBy[]) {
        if (ob.expression && exprReferencesNames(ob.expression, names)) {
          return true;
        }
        if (typeof ob.using === "string" && names.has(ob.using)) return true;
      }
      return false;
    }
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
      return (
        exprReferencesNames(lv.object as LuaExpression, names) ||
        exprReferencesNames(lv.key, names)
      );
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

function statementCapturesNames(s: LuaStatement, names: Set<string>): boolean {
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
      return (
        exprCapturesNames(e.left, names) || exprCapturesNames(e.right, names)
      );
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
      return (
        exprCapturesNames(e.object, names) || exprCapturesNames(e.key, names)
      );
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
          case "Select":
          case "GroupBy":
          case "Leading":
            for (const f of c.fields) {
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
            break;
          case "Where":
          case "Having":
            if (exprCapturesNames(c.expression, names)) return true;
            break;
          case "Limit":
            if (exprCapturesNames(c.limit, names)) return true;
            if (c.offset && exprCapturesNames(c.offset, names)) return true;
            break;
          case "OrderBy":
            for (let j = 0; j < c.orderBy.length; j++) {
              const e = c.orderBy[j].expression;
              if (e && exprCapturesNames(e, names)) {
                return true;
              }
              const u = c.orderBy[j].using;
              if (u && typeof u !== "string") {
                if (functionBodyCapturesNames(u, names)) return true;
              }
            }
            break;
        }
      }
      return false;
    case "FilteredCall":
      return (
        exprCapturesNames(e.call, names) || exprCapturesNames(e.filter, names)
      );
    case "AggregateCall": {
      const ac = e as any;
      if (exprCapturesNames(ac.call, names)) return true;
      for (const ob of ac.orderBy as LuaOrderBy[]) {
        if (ob.expression && exprCapturesNames(ob.expression, names)) {
          return true;
        }
        const u = ob.using;
        if (u && typeof u !== "string") {
          if (functionBodyCapturesNames(u, names)) return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function parseBlock(t: ParseTree, ctx: ASTCtx): LuaBlock {
  if (t.type !== "Block") {
    throw new Error(`Expected Block, got ${t.type}`);
  }
  const stmtNodes = t.children!.filter((c) => c?.type);
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
          hasFunctionDef =
            expressionHasFunctionDef(call.prefix) ||
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
          hasFunctionDef =
            expressionHasFunctionDef((s as any).start) ||
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
      let elseBlock: LuaBlock | undefined;
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
        variables: t
          .children![0].children!.filter((c) => c.type && c.type !== ",")
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
          t.children![0]?.text ? t.children![0].text : String(t.type)
        }`,
      );
  }
}

function parseFunctionCall(
  t: ParseTree,
  ctx: ASTCtx,
): LuaFunctionCallExpression {
  if (t.children![1] && t.children![1].type === ":") {
    const { args, aggOrderBy, argModifier, wildcardArg } =
      parseFunctionArgsWithOrderBy(t.children!.slice(3), ctx);
    const result: LuaFunctionCallExpression = {
      type: "FunctionCall",
      prefix: parsePrefixExpression(t.children![0], ctx),
      name: t.children![2].children![0].text!,
      args,
      ctx: context(t, ctx),
    };
    if (aggOrderBy) {
      (result as any).orderBy = aggOrderBy;
    }
    if (argModifier) {
      result.argModifier = argModifier;
    }
    if (wildcardArg) {
      result.wildcardArg = wildcardArg;
    }
    return result;
  }
  const { args, aggOrderBy, argModifier, wildcardArg } =
    parseFunctionArgsWithOrderBy(t.children!.slice(1), ctx);
  const result: LuaFunctionCallExpression = {
    type: "FunctionCall",
    prefix: parsePrefixExpression(t.children![0], ctx),
    args,
    ctx: context(t, ctx),
  };
  if (aggOrderBy) {
    (result as any).orderBy = aggOrderBy;
  }
  if (argModifier) {
    result.argModifier = argModifier;
  }
  if (wildcardArg) {
    result.wildcardArg = wildcardArg;
  }
  return result;
}

function parseAttNames(t: ParseTree, ctx: ASTCtx): LuaAttName[] {
  if (t.type !== "AttNameList") {
    throw new Error(`Expected AttNameList, got ${t.type}`);
  }
  return t
    .children!.filter((c) => c.type && c.type !== ",")
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
  let colonName: string | undefined;
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
  return t
    .children!.filter((c) => c.type === "Name")
    .map((c) => c.children![0].text!);
}

function parseExpList(t: ParseTree, ctx: ASTCtx): LuaExpression[] {
  if (t.type !== "ExpList") {
    throw new Error(`Expected ExpList, got ${t.type}`);
  }
  return t
    .children!.filter((c) => c.type && c.type !== ",")
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
  return s
    .slice(1, -1)
    .replace(
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
        // biome-ignore lint/correctness/useParseIntRadix: hex strings need auto-detect radix
        value: text.includes("x") ? parseInt(text) : parseFloat(text),
        numericType: /[.eEpP]/.test(text) ? "float" : "int",
        ctx: context(t, ctx),
      };
    }
    case "BinaryExpression": {
      const operator = t.children![1].children![0].text!;

      if (operator === "in") {
        const left = parseExpression(t.children![0], ctx);
        const right = parseExpression(t.children![2], ctx);

        // Normalize:
        //   not a in b
        // into:
        //   not (a in b)
        if (left.type === "Unary" && left.operator === "not") {
          return {
            type: "Unary",
            operator: "not",
            argument: {
              type: "QueryIn",
              left: left.argument,
              right,
              ctx: context(t, ctx),
            },
            ctx: context(t, ctx),
          };
        }

        return {
          type: "QueryIn",
          left,
          right,
          ctx: context(t, ctx),
        };
      }

      return {
        type: "Binary",
        operator,
        left: parseExpression(t.children![0], ctx),
        right: parseExpression(t.children![2], ctx),
        ctx: context(t, ctx),
      };
    }
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
    case "TableConstructor": {
      const fieldNodes = t
        .children!.slice(1, -1)
        .filter((c) =>
          [
            "FieldExp",
            "FieldProp",
            "FieldDynamic",
            "FieldStar",
            "FieldStarStar",
            "FieldStarSource",
            "FieldStarColumn",
          ].includes(c.type!),
        );
      // Wildcard fields are accepted by the grammar so that `select { t.* }`
      // can round-trip through Lezer, but they are SLIQ-only — reject them
      // in any TableConstructor that surfaces as a plain Lua expression.
      // `parseSelectFieldList` lifts the `select { ... }` form before this
      // path is reached, so wildcards inside the brace form never end up
      // here.
      for (const fn of fieldNodes) {
        if (
          fn.type === "FieldStar" ||
          fn.type === "FieldStarStar" ||
          fn.type === "FieldStarSource" ||
          fn.type === "FieldStarColumn"
        ) {
          throw new Error(
            "wildcard is only allowed inside `query [[ ... ]]` 'select' / 'group by' / aggregate-function args",
          );
        }
      }
      return {
        type: "TableConstructor",
        fields: fieldNodes.map((tf) => parseTableField(tf, ctx)),
        ctx: context(t, ctx),
      };
    }
    case "nil":
      return { type: "Nil", ctx: context(t, ctx) };
    case "Query": {
      const clauses = t
        .children!.slice(2, -1)
        .map((c) => parseQueryClause(c, ctx));

      const fromClause = clauses.find((c) => c.type === "From");
      const leadingClauses = clauses.filter((c) => c.type === "Leading");

      if (leadingClauses.length > 1) {
        throw new Error("at most one 'leading' clause may be specified");
      }

      if (leadingClauses.length > 0) {
        if (!fromClause || fromClause.fields.length < 2) {
          throw new Error(
            "'leading' clause is only valid when the 'from' list has multiple sources",
          );
        }

        const leadingClause = leadingClauses[0];
        if (leadingClause.fields.length === 0) {
          throw new Error("'leading' clause must name at least one relation");
        }

        const fromNames = new Set<string>();
        for (const f of fromClause.fields) {
          if (f.type !== "PropField") {
            throw new Error(
              "'leading' requires each 'from' entry to use alias = expression form",
            );
          }
          fromNames.add(f.key);
        }

        const seen = new Set<string>();
        for (const f of leadingClause.fields) {
          const name = getLeadingNameFromField(f);
          if (seen.has(name)) {
            throw new Error(
              `relation "${name}" appears more than once in 'leading'`,
            );
          }
          seen.add(name);
          if (!fromNames.has(name)) {
            throw new Error(
              `missing 'from' clause entry for table "${name}" in 'leading'`,
            );
          }
        }
      }

      return {
        type: "Query",
        clauses,
        ctx: context(t, ctx),
      };
    }
    case "FilteredCall": {
      const call = parseFunctionCall(t.children![0], ctx);
      const filterExpr = parseExpression(t.children![4], ctx);
      return {
        type: "FilteredCall",
        call,
        filter: filterExpr,
        ctx: context(t, ctx),
      };
    }
    default:
      console.error(t);
      throw new Error(`Unknown expression type: ${t.type}`);
  }
}

function parseFieldList(t: ParseTree, ctx: ASTCtx): LuaTableField[] {
  if (t.type !== "FieldList") {
    throw new Error(`Expected FieldList, got ${t.type}`);
  }
  return t
    .children!.filter(
      (c) =>
        c.type === "FieldExp" ||
        c.type === "FieldProp" ||
        c.type === "FieldDynamic",
    )
    .map((c) => parseTableField(c, ctx));
}

const FIELD_NODE_TYPES = new Set([
  "FieldExp",
  "FieldProp",
  "FieldDynamic",
  "FieldStar",
  "FieldStarStar",
  "FieldStarSource",
  "FieldStarColumn",
]);

// 'select'/'group by' field list; wildcard entries become `Star*Field`s.
//
// The grammar accepts two surface forms (both also for `group by`):
//
// 1. `select x = 1, t.*`: bare list (one `field` per entry);
//
// 2. `select { x = 1, t.* }`: brace form (a single `FieldExp` whose
//    expression is a `TableConstructor`).
//
// To keep the two forms semantically identical (and to let wildcards work
// inside the brace form), the brace form is "lifted" here: when the field
// list is exactly one `FieldExp(TableConstructor)`, the table's fields
// become the select fields directly. As a side effect this aligns the
// positional brace form (`select { x }`) with the bare form (`select x`).
function parseSelectFieldList(t: ParseTree, ctx: ASTCtx): LuaTableField[] {
  if (t.type !== "SelectFieldList") {
    throw new Error(`Expected SelectFieldList, got ${t.type}`);
  }
  const fieldNodes = t.children!.filter((c) => FIELD_NODE_TYPES.has(c.type!));
  if (fieldNodes.length === 1 && fieldNodes[0].type === "FieldExp") {
    const expChild = fieldNodes[0].children?.[0];
    if (expChild?.type === "TableConstructor") {
      const inner = expChild.children!.filter((c) =>
        FIELD_NODE_TYPES.has(c.type!),
      );
      return inner.map((c) => parseTableField(c, ctx));
    }
  }
  return fieldNodes.map((c) => parseTableField(c, ctx));
}

function getLeadingNameFromField(field: LuaTableField): string {
  if (field.type === "ExpressionField" && field.value.type === "Variable") {
    return field.value.name;
  }
  throw new Error("each entry in 'leading' clause must be a relation name");
}

function parseQueryClause(t: ParseTree, ctx: ASTCtx): LuaQueryClause {
  if (t.type !== "QueryClause") {
    throw new Error(`Expected QueryClause, got ${t.type}`);
  }
  t = t.children![0];
  switch (t.type) {
    case "FromClause": {
      // children: ckw<"from">, FromFieldList
      const fieldListNode = t.children!.find((c) => c.type === "FromFieldList");
      if (!fieldListNode) {
        throw new Error("'from' clause must contain at least one source");
      }

      const fields = parseFromFieldList(fieldListNode, ctx);

      return {
        type: "From",
        fields,
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
    case "OffsetClause": {
      return {
        type: "Offset",
        offset: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    }
    case "OrderByClause": {
      const orderBy: LuaOrderBy[] = [];
      for (const child of t.children!) {
        if (child.type === "OrderBy") {
          orderBy.push(parseOrderByNode(child, ctx));
        }
      }
      return {
        type: "OrderBy",
        orderBy,
        ctx: context(t, ctx),
      };
    }
    case "SelectClause": {
      let distinct: boolean | undefined;
      let fieldListNode: ParseTree | undefined;
      for (const c of t.children!) {
        if (c.type === "distinct") distinct = true;
        else if (c.type === "all") distinct = false;
        else if (c.type === "SelectFieldList") fieldListNode = c;
      }
      if (!fieldListNode) {
        throw new Error("'select' clause must specify a column list");
      }
      const result: LuaQueryClause = {
        type: "Select",
        fields: parseSelectFieldList(fieldListNode, ctx),
        ctx: context(t, ctx),
      };
      if (distinct !== undefined) (result as any).distinct = distinct;
      return result;
    }
    case "GroupByClause": {
      const fieldListNode = t.children!.find(
        (c) => c.type === "SelectFieldList",
      );
      if (!fieldListNode) {
        throw new Error("'group by' clause must specify a column list");
      }
      const fields = parseSelectFieldList(fieldListNode, ctx);
      // Validation of forbidden field kinds in GROUP BY is deferred to
      // `fieldsToGroupByEntries` so pcall can catch the error at runtime.
      return {
        type: "GroupBy",
        fields,
        ctx: context(t, ctx),
      };
    }
    case "HavingClause": {
      return {
        type: "Having",
        expression: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
    }
    case "LeadingClause": {
      // children: ckw<"leading">, FieldList
      const fieldListNode = t.children!.find((c) => c.type === "FieldList");
      if (!fieldListNode) {
        throw new Error("'leading' clause must list relation names");
      }

      const fields = parseFieldList(fieldListNode, ctx);
      for (const field of fields) {
        if (
          !(field.type === "ExpressionField" && field.value.type === "Variable")
        ) {
          throw new Error(
            "each entry in 'leading' clause must be a plain relation name",
          );
        }
      }

      return {
        type: "Leading",
        fields,
        ctx: context(t, ctx),
      };
    }
    case "ExplainClause": {
      const explicit = new Set<string>();
      const options: Record<string, boolean> = {
        analyze: false,
        costs: true,
        summary: false,
        timing: false,
        verbose: false,
        hints: false,
      };

      const parseBoolValue = (node: ParseTree): boolean => {
        const text =
          node.children?.[0]?.children?.[0]?.text ?? node.children?.[0]?.text;
        return text !== "false" && text !== "off" && text !== "0";
      };

      const processEntry = (child: ParseTree) => {
        const nameNode = child.children?.find(
          (c) => c.type === "ExplainOptionName",
        );
        const valNode = child.children?.find(
          (c) => c.type === "ExplainBoolValue",
        );
        const name =
          nameNode?.children?.[0]?.children?.[0]?.text ??
          nameNode?.children?.[0]?.text;
        if (name && name in options) {
          explicit.add(name);
          options[name] = valNode ? parseBoolValue(valNode) : true;
        }
      };

      for (const child of t.children!) {
        if (child.type === "ExplainBareEntry") {
          processEntry(child);
        }
      }

      const optList = t.children!.find((c) => c.type === "ExplainOptionList");
      if (optList) {
        for (const child of optList.children!) {
          if (child.type === "ExplainParenEntry") {
            processEntry(child);
          }
        }
      }

      // Defaults: timing and summary default to true when analyze is on
      if (options.analyze && !explicit.has("timing")) {
        options.timing = true;
      }
      if (options.analyze && !explicit.has("summary")) {
        options.summary = true;
      }
      if (!options.analyze && !explicit.has("summary")) {
        options.summary = false;
      }

      return {
        type: "Explain",
        analyze: options.analyze,
        verbose: options.verbose,
        summary: options.summary,
        costs: options.costs,
        timing: options.timing,
        hints: options.hints,
        ctx: context(t, ctx),
      };
    }
    default:
      console.error(t);
      throw new Error(`Unknown query clause type: ${t.type}`);
  }
}

// Parse a `UsingClause` node (shared by `OrderBy` and `JoinHint`)
function parseUsingClause(t: ParseTree, ctx: ASTCtx): string | LuaFunctionBody {
  if (t.type !== "UsingClause") {
    throw new Error(`Expected UsingClause, got ${t.type}`);
  }
  // children: kw<"using">, (Name | kw<"function">, FuncBody)
  const kids = t.children!;
  const next = kids[1];
  if (next.type === "function") {
    return parseFunctionBody(kids[2], ctx);
  }
  // Name
  return next.children![0].text!;
}

// Parse a `JoinHint` node
function parseJoinHint(t: ParseTree, ctx: ASTCtx): LuaJoinHint {
  if (t.type !== "JoinHint") {
    throw new Error(`Expected JoinHint, got ${t.type}`);
  }

  let joinType: "inner" | "semi" | "anti" | undefined;
  let kind: "hash" | "loop" | "merge" | undefined;
  let using: string | LuaFunctionBody | undefined;

  const visit = (node: ParseTree) => {
    if (node.type === "JoinType") {
      const text =
        node.children?.[0]?.children?.[0]?.text ??
        node.children?.[0]?.text ??
        node.text;
      if (text === "inner" || text === "semi" || text === "anti") {
        joinType = text;
      }
    } else if (node.type === "JoinMethod") {
      const text =
        node.children?.[0]?.children?.[0]?.text ??
        node.children?.[0]?.text ??
        node.text;
      if (text === "hash" || text === "loop" || text === "merge") {
        kind = text;
      }
    } else if (node.type === "UsingClause") {
      using = parseUsingClause(node, ctx);
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  visit(t);

  if (!kind) {
    throw new Error(
      "'join' hint must specify method: 'hash', 'loop', or 'merge'",
    );
  }

  if (using && kind !== "loop") {
    throw new Error("'using' clause is only valid with 'loop' join method");
  }

  const hint: LuaJoinHint = {
    type: "JoinHint",
    kind,
    ctx: context(t, ctx),
  };
  if (joinType) hint.joinType = joinType;
  if (using !== undefined) hint.using = using;
  return hint;
}

function parseFromFieldList(t: ParseTree, ctx: ASTCtx): LuaFromField[] {
  if (t.type !== "FromFieldList") {
    throw new Error(`Expected FromFieldList, got ${t.type}`);
  }

  const fromFieldTypes = new Set([
    "FieldExp",
    "FieldProp",
    "FieldDynamic",
    "FieldExpMaterialized",
    "FieldPropMaterialized",
    "FieldDynamicMaterialized",
  ]);

  const fields: LuaFromField[] = t
    .children!.filter((c) => fromFieldTypes.has(c.type!))
    .map((c) => {
      const fieldType = c.type!;
      const materialized = fieldType.endsWith("Materialized");

      const joinHintNode = c.children?.find((ch) => ch.type === "JoinHint");
      const withNode = c.children?.find((ch) => ch.type === "WithClause");

      const baseChildren = c.children!.filter(
        (ch) =>
          ch.type !== "materialized" &&
          ch.type !== "JoinHint" &&
          ch.type !== "WithClause",
      );

      const baseNode = {
        ...c,
        type: materialized ? fieldType.replace("Materialized", "") : fieldType,
        children: baseChildren,
      } as ParseTree;

      const base = parseTableField(baseNode, ctx);
      const joinHint = joinHintNode
        ? parseJoinHint(joinHintNode, ctx)
        : undefined;
      const withHints = withNode ? parseWithClause(withNode) : undefined;

      return {
        ...base,
        materialized,
        joinHint,
        withHints,
      };
    });

  if (fields.length < 2) {
    for (const f of fields) {
      if (f.joinHint) {
        throw new Error(
          "'join' hint is only valid when the 'from' list has multiple sources",
        );
      }
    }
  }

  return fields;
}

function parseWithClause(t: ParseTree): LuaWithHints {
  if (t.type !== "WithClause") {
    throw new Error(`Expected WithClause, got ${t.type}`);
  }

  const hints: LuaWithHints = {};

  const parseEntry = (entry: ParseTree) => {
    const nameNode = entry.children?.find((c) => c.type === "WithOptionName");
    const valueNode = entry.children?.find((c) => c.type === "WithValue");

    const key =
      nameNode?.children?.[0]?.children?.[0]?.text ??
      nameNode?.children?.[0]?.text ??
      nameNode?.text;
    const valueText =
      valueNode?.children?.[0]?.children?.[0]?.text ??
      valueNode?.children?.[0]?.text ??
      valueNode?.text;

    if (!key || !valueText) {
      throw new Error("'with' option requires a name and numeric value");
    }

    const value = Number(valueText);
    if (!Number.isFinite(value)) {
      throw new Error(`'with' option "${key}" must be numeric`);
    }
    if (value <= 0) {
      throw new Error(`'with' option "${key}" must be greater than zero`);
    }

    if (key === "rows" || key === "width") {
      if (!Number.isInteger(value)) {
        throw new Error(`'with' option "${key}" must be an integer`);
      }
      hints[key] = value;
      return;
    }

    if (key === "cost") {
      hints.cost = value;
      return;
    }

    throw new Error(`unrecognized 'with' option "${key}"`);
  };

  const walk = (node: ParseTree) => {
    if (node.type === "WithBareEntry" || node.type === "WithParenEntry") {
      parseEntry(node);
      return;
    }

    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  walk(t);

  if (
    hints.rows === undefined &&
    hints.width === undefined &&
    hints.cost === undefined
  ) {
    throw new Error("'with' clause must specify at least one planner hint");
  }

  return hints;
}

function parseOrderByExpression(t: ParseTree, ctx: ASTCtx): LuaExpression {
  if (t.type !== "OrderByExpr") {
    return parseExpression(t, ctx);
  }

  const child = t.children?.[0];
  if (!child) {
    throw new Error("'order by' expression is missing a subexpression");
  }

  if (child.type === "OrderBySelectKey") {
    const keyExprNode = child.children?.find(
      (c) => c.type && c.type !== "[" && c.type !== "]",
    );
    if (!keyExprNode) {
      throw new Error("'order by' select key is missing a key expression");
    }

    const key = parseExpression(keyExprNode, ctx);
    if (key.type !== "String") {
      throw new Error(
        "'order by' projected column key must be a string literal",
      );
    }

    const expr: LuaOrderBySelectKeyExpression = {
      type: "OrderBySelectKey",
      key,
      ctx: context(child, ctx),
    };
    return expr;
  }

  return parseExpression(child, ctx);
}

// Parse a single OrderBy node (shared by query OrderByClause and AggOrderBy)
function parseOrderByNode(child: ParseTree, ctx: ASTCtx): LuaOrderBy {
  const kids = child.children!;
  let direction: "asc" | "desc" = "asc";
  let nulls: "first" | "last" | undefined;
  let usingVal: string | LuaFunctionBody | undefined;

  for (let i = 1; i < kids.length; i++) {
    const typ = kids[i].type;
    if (typ === "desc") direction = "desc";
    else if (typ === "asc") direction = "asc";
    else if (typ === "first") nulls = "first";
    else if (typ === "last") nulls = "last";
    else if (typ === "UsingClause") {
      usingVal = parseUsingClause(kids[i], ctx);
    }
  }

  const exprNode = kids.find((k) => k.type === "OrderByExpr") ?? kids[0];

  const wildcard = detectOrderByWildcard(exprNode);
  if (wildcard) {
    const ob: LuaOrderBy = {
      type: "Order",
      wildcard,
      direction,
      ctx: context(child, ctx),
    };
    if (nulls) ob.nulls = nulls;
    if (usingVal !== undefined) ob.using = usingVal;
    return ob;
  }

  const ob: LuaOrderBy = {
    type: "Order",
    expression: parseOrderByExpression(exprNode, ctx),
    direction,
    ctx: context(child, ctx),
  };
  if (nulls) ob.nulls = nulls;
  if (usingVal !== undefined) ob.using = usingVal;
  return ob;
}

// Returns the wildcard descriptor for wildcard `OrderByExpr` subtrees,
// undefined for regular expressions.
function detectOrderByWildcard(
  t: ParseTree,
): LuaOrderBy["wildcard"] | undefined {
  if (!t) return undefined;
  const child = t.type === "OrderByExpr" ? t.children?.[0] : t;
  if (!child) return undefined;
  switch (child.type) {
    case "OrderByStar":
    case "OrderByStarStar":
      return { kind: "all" };
    case "OrderByStarSource": {
      const nameNode = child.children?.find((c) => c.type === "Name");
      if (!nameNode) return undefined;
      return {
        kind: "source",
        source: nameNode.children![0].text!,
      };
    }
    case "OrderByStarColumn": {
      const nameNode = child.children?.find((c) => c.type === "Name");
      if (!nameNode) return undefined;
      return {
        kind: "column",
        column: nameNode.children![0].text!,
      };
    }
    default:
      return undefined;
  }
}

// Parse an AggOrderBy node into LuaOrderBy[]
function parseAggOrderBy(t: ParseTree, ctx: ASTCtx): LuaOrderBy[] {
  if (t.type !== "AggOrderBy") {
    throw new Error(`Expected AggOrderBy, got ${t.type}`);
  }
  const orderBy: LuaOrderBy[] = [];
  for (const child of t.children!) {
    if (child.type === "OrderBy") {
      orderBy.push(parseOrderByNode(child, ctx));
    }
  }
  return orderBy;
}

// Parse function args plus optional AggOrderBy and wildcard arg
// (`count(*)`, `count(src.*)`).
function parseFunctionArgsWithOrderBy(
  ts: ParseTree[],
  ctx: ASTCtx,
): {
  args: LuaExpression[];
  aggOrderBy?: LuaOrderBy[];
  argModifier?: "distinct" | "all";
  wildcardArg?: LuaFunctionCallExpression["wildcardArg"];
} {
  let aggOrderBy: LuaOrderBy[] | undefined;
  let argModifier: "distinct" | "all" | undefined;
  let wildcardArg: LuaFunctionCallExpression["wildcardArg"] | undefined;
  const args: LuaExpression[] = [];
  for (const t of ts) {
    if (!t.type || [",", "(", ")"].includes(t.type)) continue;
    if (t.type === "AggOrderBy") {
      aggOrderBy = parseAggOrderBy(t, ctx);
    } else if (t.type === "distinct") {
      argModifier = "distinct";
    } else if (t.type === "all") {
      argModifier = "all";
    } else if (t.type === "FuncStarArg" || t.type === "FuncStarStarArg") {
      if (wildcardArg || args.length > 0) {
        throw new Error(
          "aggregate call cannot combine wildcard argument with other arguments",
        );
      }
      wildcardArg = { kind: "all" };
    } else if (t.type === "FuncSourceStarArg") {
      if (wildcardArg || args.length > 0) {
        throw new Error(
          "aggregate call cannot combine wildcard argument with other arguments",
        );
      }
      const nameNode = t.children!.find((c) => c.type === "Name");
      if (!nameNode) {
        throw new Error("missing relation name in qualified reference");
      }
      wildcardArg = {
        kind: "source",
        source: nameNode.children![0].text!,
      };
    } else {
      if (wildcardArg) {
        throw new Error(
          "aggregate call cannot combine wildcard argument with other arguments",
        );
      }
      args.push(parseExpression(t, ctx));
    }
  }
  return { args, aggOrderBy, argModifier, wildcardArg };
}

function parseFunctionBody(t: ParseTree, ctx: ASTCtx): LuaFunctionBody {
  if (t.type !== "FuncBody") {
    throw new Error(`Expected FunctionBody, got ${t.type}`);
  }
  return {
    type: "FunctionBody",
    parameters: t
      .children![1].children!.filter(
        (c) => c.type && ["Name", "Ellipsis"].includes(c.type),
      )
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
    case "FieldDynamic": {
      const exprChildren = t.children!.filter(
        (c) => c.type && c.type !== "[" && c.type !== "]" && c.type !== "=",
      );

      if (exprChildren.length < 2) {
        throw new Error("FieldDynamic requires key and value expressions");
      }

      return {
        type: "DynamicField",
        key: parseExpression(exprChildren[0], ctx),
        value: parseExpression(exprChildren[1], ctx),
        ctx: context(t, ctx),
      };
    }
    // `*` and `*.*` collapse into the same AST (identical semantics).
    case "FieldStar":
    case "FieldStarStar":
      return {
        type: "StarField",
        ctx: context(t, ctx),
      };
    case "FieldStarSource": {
      const nameNode = t.children!.find((c) => c.type === "Name");
      if (!nameNode) {
        throw new Error("missing relation name in qualified reference");
      }
      return {
        type: "StarSourceField",
        source: nameNode.children![0].text!,
        ctx: context(t, ctx),
      };
    }
    case "FieldStarColumn": {
      const nameNode = t.children!.find((c) => c.type === "Name");
      if (!nameNode) {
        throw new Error("missing column name in wildcard reference");
      }
      return {
        type: "StarColumnField",
        column: nameNode.children![0].text!,
        ctx: context(t, ctx),
      };
    }
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
        const closeBracket = `]${"=".repeat(equalsCount)}]`;
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
          const closeBracket = `]${"=".repeat(equalsCount)}]`;
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
        LuaStackFrame.lostFrame.withCtx((e as any).astCtx as ASTCtx),
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
export function parseExpressionString(expr: string): LuaExpression {
  const parsedLua = parse(`_(${expr})`) as LuaBlock;
  return (parsedLua.statements[0] as LuaFunctionCallStatement).call.args[0];
}
