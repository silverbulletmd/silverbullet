import type { LuaBlock } from "../../space_lua/ast.ts";
import {
  BUSY_LIMIT_DEFAULT_MS,
  LuaBudgetStopped,
  makeLuaBudget,
} from "../../space_lua/budget.ts";
import {
  type BudgetNotifier,
  offerStopNotification,
} from "../../space_lua/budget_ui.ts";
import { evalStatement } from "../../space_lua/eval.ts";
import { parseBlock } from "../../space_lua/parse.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
} from "../../space_lua/runtime.ts";
import { CONSOLE_REF_PREFIX } from "../shared/source_frames.ts";
import type { ConsoleLog } from "./console_log.ts";

export type BudgetUi = Pick<BudgetNotifier, "flashNotification">;

/**
 * Console input, parsed once. An expression parses as `return <code>`, which
 * keeps multiple values and trailing comments; anything else as a block.
 */
export type ParsedInput =
  | { kind: "expression"; block: LuaBlock; count: number }
  | { kind: "block"; block: LuaBlock }
  /** `incomplete`: the input stops inside an unterminated construct. */
  | { kind: "invalid"; error: unknown; incomplete: boolean };

const RETURN_PREFIX = "return ";

export function parseInput(code: string, ref?: string): ParsedInput {
  try {
    const block = parseBlock(`${RETURN_PREFIX}${code}`, { ref });
    shiftPositions(block, -RETURN_PREFIX.length);
    const [statement] = block.statements;
    const count =
      statement?.type === "Return" ? statement.expressions.length : 0;
    return { kind: "expression", block, count };
  } catch {
    // Not an expression; parse it as a block
  }
  try {
    return { kind: "block", block: parseBlock(code, { ref }) };
  } catch (error) {
    // The parser reports an unterminated construct at end of input
    const from =
      error instanceof LuaRuntimeError ? error.sf.astCtx?.from : undefined;
    const trimmed = code.trimEnd();
    const incomplete =
      !!trimmed && from !== undefined && from >= trimmed.length;
    return { kind: "invalid", error, incomplete };
  }
}

/** Whether `code` is a single expression, so it could stand in `${…}`. */
export function isExpressionInput(code: string): boolean {
  const parsed = parseInput(code.trim());
  return parsed.kind === "expression" && parsed.count === 1;
}

export function isIncompleteInput(code: string): boolean {
  const parsed = parseInput(code.trimEnd());
  return parsed.kind === "invalid" && parsed.incomplete;
}

export class ConsoleSession {
  private readonly sources = new Map<string, string>();
  // One env for the session's lifetime: console closures capture it
  private readonly locals = new LuaEnv();
  private counter = 0;
  // Inputs run one after another, as typed: a later input may use an earlier one's locals
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private opts: {
      spaceEnv: () => LuaEnv;
      log: ConsoleLog;
      ui: () => BudgetUi;
      busyLimitMs?: number;
    },
  ) {}

  /**
   * The console's env, attached to the current space env. Reloading space
   * scripts replaces that env, so this re-attaches the locals to it.
   */
  env(): LuaEnv {
    this.locals.parent = this.opts.spaceEnv();
    return this.locals;
  }

  sourceFor(ref: string): string | undefined {
    return this.sources.get(ref);
  }

  localNames(): string[] {
    return [...this.locals.variables.keys()];
  }

  run(code: string): Promise<void> {
    const next = this.queue.then(() => this.evaluate(code));
    this.queue = next.catch(() => {});
    return next;
  }

  private async evaluate(code: string): Promise<void> {
    const ref = `${CONSOLE_REF_PREFIX}${++this.counter}`;
    this.sources.set(ref, code);
    const { log } = this.opts;
    log.append({ kind: "input", ref, code });

    const env = this.env();
    const budget = makeLuaBudget({
      busyLimitMs: this.opts.busyLimitMs ?? BUSY_LIMIT_DEFAULT_MS,
      onLimit: (b) =>
        offerStopNotification(
          this.opts.ui(),
          "Console code is taking a while",
          b,
        ),
    });
    const tl = new LuaEnv();
    tl.setLocal("_GLOBAL", env);
    try {
      const parsed = parseInput(code, ref);
      if (parsed.kind === "invalid") throw parsed.error;
      const sf = new LuaStackFrame(tl, parsed.block.ctx, undefined, undefined, {
        closeStack: undefined,
        budget,
      });
      let values: unknown[] = [];
      // Top-level statements run directly in the console env so `local`s persist
      for (const stmt of parsed.block.statements) {
        const signal = await evalStatement(stmt, env, sf, true);
        if (signal && typeof signal === "object" && "ctrl" in signal) {
          if (signal.ctrl === "return") values = (signal as any).values ?? [];
          break;
        }
      }
      if (parsed.kind === "expression" || values.length > 0) {
        log.append({ kind: "result", values });
      }
    } catch (e) {
      if (e instanceof LuaBudgetStopped) {
        log.append({ kind: "stopped" });
      } else {
        log.message("error", "lua", [e], { origin: { ref } });
      }
    } finally {
      budget.finished = true;
    }
  }
}

// `parseInput` parses expressions behind a prefix; positions must point into the input itself
function shiftPositions(block: LuaBlock, delta: number): void {
  const seen = new Set<object>();
  const walk = (n: any) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    const ctx = n.ctx;
    if (ctx && typeof ctx === "object" && !seen.has(ctx)) {
      seen.add(ctx);
      if (typeof ctx.from === "number") ctx.from += delta;
      if (typeof ctx.to === "number") ctx.to += delta;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(block);
}
