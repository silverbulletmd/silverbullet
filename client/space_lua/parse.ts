import { lezerToParseTree } from "../../client/markdown_parser/parse_tree.ts";
import type { SyntaxNode } from "@lezer/common";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
// @ts-expect-error - Local generated JavaScript file without type definitions
import { parser } from "./parse-lua.js";
import { styleTags, tags as t } from "@lezer/highlight";
import { indentNodeProp, LRLanguage } from "@codemirror/language";
import type {
  ASTCtx,
  LuaAttName,
  LuaBlock,
  LuaComment,
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
import type { LuaFunctionDocumentation } from "../../plug-api/types/index.ts";
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
  "return break goto do end while repeat until function local if then else elseif in for nil or and not query from where limit offset select order by desc asc nulls first last group having filter using":
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
  const block = t.children?.find((child) => child.type === "Block");
  if (!block) {
    return { type: "Block", statements: [], ctx: context(t, ctx) };
  }
  return parseBlockNode(block, ctx);
}

function collectLuaComments(t: ParseTree, ctx: ASTCtx): LuaComment[] {
  const comments: LuaComment[] = [];
  const visit = (node: ParseTree) => {
    if (node.type === "Comment") {
      const text = renderToText(node);
      comments.push({
        type: "Comment",
        text,
        kind: /^--\[(=*)\[/.test(text) ? "long" : "line",
        ctx: context(node, ctx),
      });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(t);
  return comments.sort((a, b) => (a.ctx.from ?? 0) - (b.ctx.from ?? 0));
}

function withoutComments(t: ParseTree): ParseTree {
  if (!t.children) return t;
  return {
    ...t,
    children: t.children
      .filter((child) => child.type !== "Comment")
      .map(withoutComments),
  };
}

function assignCommentsToBlocks(
  root: LuaBlock,
  comments: LuaComment[],
  source: string,
): void {
  const blocks: LuaBlock[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown, key?: string) => {
    if (!value || typeof value !== "object" || key === "ctx") return;
    if (seen.has(value)) return;
    seen.add(value);
    if ((value as { type?: string }).type === "Block") {
      blocks.push(value as LuaBlock);
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (
        childKey !== "ctx" &&
        childKey !== "comments" &&
        childKey !== "documentation"
      ) {
        visit(child, childKey);
      }
    }
  };
  visit(root);

  for (const comment of comments) {
    const from = comment.ctx.from ?? 0;
    const to = comment.ctx.to ?? from;
    let owner = root;
    let ownerSpan = Number.POSITIVE_INFINITY;
    for (const block of blocks) {
      if (block === root) continue;
      const blockFrom = block.ctx.from;
      const blockTo = block.ctx.to;
      if (blockFrom === undefined || blockTo === undefined) continue;
      const contains = blockFrom <= from && blockTo >= to;
      const immediatelyBefore =
        to <= blockFrom && !source.slice(to, blockFrom).trim();
      const immediatelyAfter =
        blockTo <= from && !source.slice(blockTo, from).trim();
      if (
        (contains || immediatelyBefore || immediatelyAfter) &&
        blockTo - blockFrom < ownerSpan
      ) {
        owner = block;
        ownerSpan = blockTo - blockFrom;
      }
    }
    (owner.comments ??= []).push(comment);
  }
}

function parseFunctionDocumentation(
  comments: LuaComment[],
): LuaFunctionDocumentation | undefined {
  const description: string[] = [];
  const parameters: NonNullable<LuaFunctionDocumentation["parameters"]> = [];
  const returns: NonNullable<LuaFunctionDocumentation["returns"]> = [];
  let deprecated: string | boolean | undefined;
  let see: string | undefined;

  for (const comment of comments) {
    const line = comment.text.slice(3).replace(/^\s?/, "");
    const param = /^@param\s+(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (param) {
      const optional = param[1].endsWith("?");
      parameters.push({
        name: optional ? param[1].slice(0, -1) : param[1],
        type: param[2],
        description: param[3] || undefined,
        optional,
      });
      continue;
    }
    const returnDoc = /^@return\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (returnDoc) {
      returns.push({
        type: returnDoc[1],
        description: returnDoc[2] || undefined,
      });
      continue;
    }
    const deprecatedDoc = /^@deprecated(?:\s+(.*))?$/.exec(line);
    if (deprecatedDoc) {
      deprecated = deprecatedDoc[1] || true;
      continue;
    }
    const seeDoc = /^@see\s+(.+)$/.exec(line);
    if (seeDoc) {
      see = seeDoc[1];
      continue;
    }
    if (!line.startsWith("@")) description.push(line);
  }

  const docs: LuaFunctionDocumentation = {};
  const descriptionText = description.join("\n").trim();
  if (descriptionText) docs.description = descriptionText;
  if (parameters.length) docs.parameters = parameters;
  if (returns.length) docs.returns = returns;
  if (deprecated !== undefined) docs.deprecated = deprecated;
  if (see) docs.see = see;
  return Object.keys(docs).length ? docs : undefined;
}

function attachFunctionDocumentation(
  root: LuaBlock,
  comments: LuaComment[],
  source: string,
): void {
  const candidates: { from: number; body: LuaFunctionBody }[] = [];
  const seen = new WeakSet<object>();
  const claimedBodies = new WeakSet<LuaFunctionBody>();

  const addCandidate = (from: number | undefined, body: LuaFunctionBody) => {
    if (from === undefined || claimedBodies.has(body)) return;
    claimedBodies.add(body);
    candidates.push({ from, body });
  };

  const visit = (value: unknown, key?: string) => {
    if (!value || typeof value !== "object" || key === "ctx") return;
    if (seen.has(value)) return;
    seen.add(value);
    const node = value as Record<string, any>;
    if (node.type === "Function" || node.type === "LocalFunction") {
      addCandidate(node.ctx?.from, node.body);
    } else if (
      (node.type === "Local" || node.type === "Assignment") &&
      node.expressions?.length === 1 &&
      node.expressions[0]?.type === "FunctionDefinition"
    ) {
      addCandidate(node.ctx?.from, node.expressions[0].body);
    } else if (node.type === "FunctionDefinition") {
      addCandidate(node.ctx?.from, node.body);
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (
        childKey !== "ctx" &&
        childKey !== "comments" &&
        childKey !== "documentation"
      ) {
        visit(child, childKey);
      }
    }
  };
  visit(root);

  const docComments = comments.filter(
    (comment) => comment.kind === "line" && comment.text.startsWith("---"),
  );
  for (const candidate of candidates) {
    const group: LuaComment[] = [];
    let boundary = candidate.from;
    for (let i = docComments.length - 1; i >= 0; i--) {
      const comment = docComments[i];
      const from = comment.ctx.from ?? 0;
      const to = comment.ctx.to ?? from;
      if (to > boundary) continue;
      const gap = source.slice(to, boundary);
      const lineStart = source.lastIndexOf("\n", from - 1) + 1;
      if (
        gap.trim() ||
        /\r?\n[ \t]*\r?\n/.test(gap) ||
        source.slice(lineStart, from).trim()
      ) {
        break;
      }
      group.unshift(comment);
      boundary = from;
    }
    const documentation = parseFunctionDocumentation(group);
    if (documentation) candidate.body.documentation = documentation;
  }
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
              if (expressionHasFunctionDef(c.orderBy[j].expression)) {
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
            expressionHasFunctionDef(ob.expression) ||
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
              if (exprReferencesNames(c.orderBy[j].expression, names)) {
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
        if (exprReferencesNames(ob.expression, names)) return true;
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
              if (exprCapturesNames(c.orderBy[j].expression, names)) {
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
        if (exprCapturesNames(ob.expression, names)) return true;
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

function parseBlockNode(t: ParseTree, ctx: ASTCtx): LuaBlock {
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
      return parseBlockNode(t.children![1], ctx);
    case ";":
      return { type: "Semicolon", ctx: context(t, ctx) };
    case "WhileStatement":
      return {
        type: "While",
        condition: parseExpression(t.children![1], ctx),
        block: parseBlockNode(t.children![3], ctx),
        ctx: context(t, ctx),
      };
    case "RepeatStatement":
      return {
        type: "Repeat",
        block: parseBlockNode(t.children![1], ctx),
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
            block: parseBlockNode(t.children![i + 3], ctx),
            from: child.from,
            to: child.to,
          });
        } else if (token === "else") {
          elseBlock = parseBlockNode(t.children![i + 1], ctx);
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
        const block = parseBlockNode(t.children![3], ctx);
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
      const block = parseBlockNode(t.children![3], ctx);
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
    const { args, aggOrderBy } = parseFunctionArgsWithOrderBy(
      t.children!.slice(3),
      ctx,
    );
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
    return result;
  }
  const { args, aggOrderBy } = parseFunctionArgsWithOrderBy(
    t.children!.slice(1),
    ctx,
  );
  const result: LuaFunctionCallExpression = {
    type: "FunctionCall",
    prefix: parsePrefixExpression(t.children![0], ctx),
    args,
    ctx: context(t, ctx),
  };
  if (aggOrderBy) {
    (result as any).orderBy = aggOrderBy;
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
      return {
        type: "Parenthesized",
        expression: parseExpression(t.children![1], ctx),
        ctx: context(t, ctx),
      };
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
        fields: t
          .children!.slice(1, -1)
          .filter((c) =>
            ["FieldExp", "FieldProp", "FieldDynamic"].includes(c.type!),
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

function parseQueryClause(t: ParseTree, ctx: ASTCtx): LuaQueryClause {
  if (t.type !== "QueryClause") {
    throw new Error(`Expected QueryClause, got ${t.type}`);
  }
  t = t.children![0];
  switch (t.type) {
    case "FromClause": {
      // children: ckw<"from">, FieldList
      const fieldListNode = t.children!.find((c) => c.type === "FieldList");
      if (!fieldListNode) {
        throw new Error("FromClause missing FieldList");
      }
      return {
        type: "From",
        fields: parseFieldList(fieldListNode, ctx),
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
      // children: ckw<"select">, FieldList
      const fieldListNode = t.children!.find((c) => c.type === "FieldList");
      if (!fieldListNode) {
        throw new Error("SelectClause missing FieldList");
      }
      return {
        type: "Select",
        fields: parseFieldList(fieldListNode, ctx),
        ctx: context(t, ctx),
      };
    }
    case "GroupByClause": {
      // children: ckw<"group">, ckw<"by">, FieldList
      const fieldListNode = t.children!.find((c) => c.type === "FieldList");
      if (!fieldListNode) {
        throw new Error("GroupByClause missing FieldList");
      }
      return {
        type: "GroupBy",
        fields: parseFieldList(fieldListNode, ctx),
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
    default:
      console.error(t);
      throw new Error(`Unknown query clause type: ${t.type}`);
  }
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
    else if (typ === "using") {
      const next = kids[i + 1];
      if (next.type === "function") {
        usingVal = parseFunctionBody(kids[i + 2], ctx);
        i += 2;
      } else {
        usingVal = next.children![0].text!;
        i++;
      }
    }
  }
  const ob: LuaOrderBy = {
    type: "Order",
    expression: parseExpression(kids[0], ctx),
    direction,
    ctx: context(child, ctx),
  };
  if (nulls) ob.nulls = nulls;
  if (usingVal !== undefined) ob.using = usingVal;
  return ob;
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

// Parse function args, extracting AggOrderBy if present inside funcParams
function parseFunctionArgsWithOrderBy(
  ts: ParseTree[],
  ctx: ASTCtx,
): { args: LuaExpression[]; aggOrderBy?: LuaOrderBy[] } {
  let aggOrderBy: LuaOrderBy[] | undefined;
  const args: LuaExpression[] = [];
  for (const t of ts) {
    if (!t.type || [",", "(", ")"].includes(t.type)) continue;
    if (t.type === "AggOrderBy") {
      aggOrderBy = parseAggOrderBy(t, ctx);
    } else {
      args.push(parseExpression(t, ctx));
    }
  }
  return { args, aggOrderBy };
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
    block: parseBlockNode(t.children![3], ctx),
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

export function parseBlock(s: string, ctx: ASTCtx = {}): LuaBlock {
  try {
    const concreteTree = parseToAST(s);
    const comments = collectLuaComments(concreteTree, ctx);
    const result = parseChunk(withoutComments(concreteTree), ctx);
    assignCommentsToBlocks(result, comments, s);
    attachFunctionDocumentation(result, comments, s);
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
  return cleanLuaTree(n);
}

function cleanLuaTree(tree: ParseTree): ParseTree {
  if (tree.type === "⚠") {
    throw new Error(`Parse error at pos ${tree.from}`);
  }
  if (tree.text !== undefined) return tree;
  const result: ParseTree = {
    type: tree.type,
    children: [],
    from: tree.from,
    to: tree.to,
  };
  for (const node of tree.children ?? []) {
    if (node.type) result.children!.push(cleanLuaTree(node));
    if (node.text?.trim()) result.children!.push(node);
  }
  return result;
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
  const parsedLua = parseBlock(`_(${expr})`) as LuaBlock;
  return (parsedLua.statements[0] as LuaFunctionCallStatement).call.args[0];
}
