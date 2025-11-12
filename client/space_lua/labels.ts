// Goto/label resolution and validation for function bodies

import type {
  ASTCtx,
  LuaBlock,
  LuaForInStatement,
  LuaForStatement,
  LuaGotoStatement,
  LuaIfStatement,
  LuaLabelStatement,
  LuaLocalStatement,
  LuaRepeatStatement,
  LuaWhileStatement,
} from "./ast.ts";
import { asBlock } from "./ast_narrow.ts";

type BlockGotoMeta = {
  labels: Map<string, number>; // in this block
};

type FunctionMeta = {
  blockMeta: WeakMap<LuaBlock, BlockGotoMeta>;
  funcHasGotos: boolean;
};

class LabelResolveError extends Error {
  constructor(msg: string, public astCtx: ASTCtx) {
    super(msg);
  }
}

// Cache
const functionMetaByRoot = new WeakMap<LuaBlock, FunctionMeta>();
const functionMetaByAnyBlock = new WeakMap<LuaBlock, FunctionMeta>();

export function getBlockGotoMeta(
  block: LuaBlock,
): (BlockGotoMeta & { funcHasGotos: boolean }) | undefined {
  let fm = functionMetaByAnyBlock.get(block);
  if (!fm) {
    fm = resolveFunction(block);
  }
  const bm = fm.blockMeta.get(block);
  if (!bm) {
    return undefined;
  }
  return { ...bm, funcHasGotos: fm.funcHasGotos };
}

type LocalID = number;

type GotoInfo = {
  node: LuaGotoStatement;
  active: Set<LocalID>;
  block: LuaBlock;
};

type ValidationCtx = {
  labelActiveByBlock: WeakMap<LuaBlock, Map<string, Set<LocalID>>>;
  labelLocByBlock: WeakMap<
    LuaBlock,
    Map<string, { index: number; ctx: ASTCtx }>
  >;
  gotos: GotoInfo[];
  hasGoto: boolean;
  nextLocalId: number;
};

type BlockRole =
  | "Root"
  | "Do"
  | "If"
  | "While"
  | "Repeat"
  | "For"
  | "ForIn";

function resolveFunction(root: LuaBlock): FunctionMeta {
  const existing = functionMetaByRoot.get(root);
  if (existing) {
    return existing;
  }

  const blockMeta = new WeakMap<LuaBlock, BlockGotoMeta>();
  const vctx: ValidationCtx = {
    labelActiveByBlock: new WeakMap(),
    labelLocByBlock: new WeakMap(),
    gotos: [],
    hasGoto: false,
    nextLocalId: 1,
  };

  const seenBlocks = new Set<LuaBlock>();
  const parentByBlock = new WeakMap<LuaBlock, LuaBlock | undefined>();
  const roleByBlock = new WeakMap<LuaBlock, BlockRole>();

  processBlock(
    root,
    undefined,
    "Root",
    new Set<LocalID>(),
    new Set<string>(),
    blockMeta,
    vctx,
    seenBlocks,
    parentByBlock,
    roleByBlock,
  );

  // Validate gotos
  for (const g of vctx.gotos) {
    const target = g.node.name;

    // Search current block for the label, then ancestors
    let searchBlock: LuaBlock | undefined = g.block;
    let labelIndex: number | undefined;
    let labelDefBlock: LuaBlock | undefined;

    while (searchBlock) {
      const meta = blockMeta.get(searchBlock);
      if (meta && meta.labels.has(target)) {
        labelIndex = meta.labels.get(target);
        labelDefBlock = searchBlock;
        break;
      }
      searchBlock = parentByBlock.get(searchBlock);
    }

    if (labelIndex === undefined || !labelDefBlock) {
      throw new LabelResolveError(
        `no visible label '${target}' for goto`,
        g.node.ctx,
      );
    }

    const activeMap = vctx.labelActiveByBlock.get(labelDefBlock);
    const locMap = vctx.labelLocByBlock.get(labelDefBlock);
    if (!activeMap || !locMap) {
      throw new LabelResolveError(
        `no visible label '${target}' for goto`,
        g.node.ctx,
      );
    }

    const lset = activeMap.get(target);
    const lloc = locMap.get(target);
    if (!lset || !lloc) {
      throw new LabelResolveError(
        `no visible label '${target}' for goto`,
        g.node.ctx,
      );
    }

    // Local scope forward jump check
    let entersLocalScope = false;
    for (const id of lset) {
      if (!g.active.has(id)) {
        entersLocalScope = true;
        break;
      }
    }
    if (entersLocalScope) {
      const safeEnd = isSafeEndLabel(labelDefBlock, lloc.index, roleByBlock);
      if (!safeEnd) {
        throw new LabelResolveError(
          `goto '${target}' jumps into the scope of a local variable`,
          g.node.ctx,
        );
      }
    }
  }

  const fm: FunctionMeta = {
    blockMeta,
    funcHasGotos: vctx.hasGoto,
  };

  functionMetaByRoot.set(root, fm);
  for (const block of seenBlocks) {
    functionMetaByAnyBlock.set(block, fm);
  }

  return fm;
}

function isSafeEndLabel(
  block: LuaBlock,
  labelIndex: number,
  roleByBlock: WeakMap<LuaBlock, BlockRole>,
): boolean {
  const role = roleByBlock.get(block);
  if (role === "Repeat") {
    return false;
  }
  for (let i = labelIndex + 1; i < block.statements.length; i++) {
    const t = block.statements[i].type;
    if (t !== "Label" && t !== "Semicolon") {
      return false;
    }
  }
  return true;
}

function cloneSet<T>(s: Set<T>): Set<T> {
  const c = new Set<T>();
  for (const v of s) {
    c.add(v);
  }
  return c;
}

function processBlock(
  block: LuaBlock,
  parent: LuaBlock | undefined,
  role: BlockRole,
  active: Set<LocalID>,
  visibleLabels: Set<string>,
  blockMeta: WeakMap<LuaBlock, BlockGotoMeta>,
  vctx: ValidationCtx,
  seen: Set<LuaBlock>,
  parentByBlock: WeakMap<LuaBlock, LuaBlock | undefined>,
  roleByBlock: WeakMap<LuaBlock, BlockRole>,
): void {
  const labels = new Map<string, number>();
  blockMeta.set(block, { labels });

  seen.add(block);
  parentByBlock.set(block, parent);
  roleByBlock.set(block, role);
  functionMetaByAnyBlock.set(block, {
    blockMeta,
    funcHasGotos: false,
  });

  const labelActiveMap = new Map<string, Set<LocalID>>();
  const labelLocMap = new Map<string, { index: number; ctx: ASTCtx }>();
  vctx.labelActiveByBlock.set(block, labelActiveMap);
  vctx.labelLocByBlock.set(block, labelLocMap);

  const curActive = cloneSet(active);
  const vis = new Set<string>(visibleLabels);

  const stmts = block.statements;
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    switch (s.type) {
      case "Label": {
        const lab = s as LuaLabelStatement;
        if (vis.has(lab.name)) {
          throw new LabelResolveError(
            `label '${lab.name}' already defined`,
            lab.ctx,
          );
        }
        labels.set(lab.name, i);
        const actSet = cloneSet(curActive);
        labelActiveMap.set(lab.name, actSet);
        labelLocMap.set(lab.name, { index: i, ctx: lab.ctx });
        vis.add(lab.name);
        break;
      }
      case "Goto": {
        const g = s as LuaGotoStatement;
        vctx.hasGoto = true;
        vctx.gotos.push({ node: g, active: cloneSet(curActive), block });
        break;
      }
      case "Local": {
        const l = s as LuaLocalStatement;
        for (let j = 0; j < l.names.length; j++) {
          curActive.add(vctx.nextLocalId++);
        }
        break;
      }
      case "LocalFunction": {
        curActive.add(vctx.nextLocalId++);
        break;
      }
      case "Function": {
        break;
      }
      case "For": {
        const fr = s as LuaForStatement;
        const childActive = cloneSet(curActive);
        childActive.add(vctx.nextLocalId++);
        processBlock(
          fr.block,
          block,
          "For",
          childActive,
          new Set<string>(vis),
          blockMeta,
          vctx,
          seen,
          parentByBlock,
          roleByBlock,
        );
        break;
      }
      case "ForIn": {
        const fi = s as LuaForInStatement;
        const childActive = cloneSet(curActive);
        for (let j = 0; j < fi.names.length; j++) {
          childActive.add(vctx.nextLocalId++);
        }
        processBlock(
          fi.block,
          block,
          "ForIn",
          childActive,
          new Set<string>(vis),
          blockMeta,
          vctx,
          seen,
          parentByBlock,
          roleByBlock,
        );
        break;
      }
      case "While": {
        const w = s as LuaWhileStatement;
        processBlock(
          w.block,
          block,
          "While",
          cloneSet(curActive),
          new Set<string>(vis),
          blockMeta,
          vctx,
          seen,
          parentByBlock,
          roleByBlock,
        );
        break;
      }
      case "Repeat": {
        const r = s as LuaRepeatStatement;
        processBlock(
          r.block,
          block,
          "Repeat",
          cloneSet(curActive),
          new Set<string>(vis),
          blockMeta,
          vctx,
          seen,
          parentByBlock,
          roleByBlock,
        );
        break;
      }
      case "If": {
        const iff = s as LuaIfStatement;
        for (let k = 0; k < iff.conditions.length; k++) {
          processBlock(
            iff.conditions[k].block,
            block,
            "If",
            cloneSet(curActive),
            new Set<string>(vis),
            blockMeta,
            vctx,
            seen,
            parentByBlock,
            roleByBlock,
          );
        }
        if (iff.elseBlock) {
          processBlock(
            iff.elseBlock,
            block,
            "If",
            cloneSet(curActive),
            new Set<string>(vis),
            blockMeta,
            vctx,
            seen,
            parentByBlock,
            roleByBlock,
          );
        }
        break;
      }
      case "Block": {
        const child = asBlock(s);
        processBlock(
          child,
          block,
          "Do",
          cloneSet(curActive),
          new Set<string>(vis),
          blockMeta,
          vctx,
          seen,
          parentByBlock,
          roleByBlock,
        );
        break;
      }
      default: {
        break;
      }
    }
  }
}
