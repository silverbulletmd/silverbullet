// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  type LuaTable,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// happy-dom replaces import.meta.url's scheme; tests run from the repo root.
async function stdPage(page: string): Promise<string> {
  return await readFile(path.resolve("libraries/Library/Std", page), "utf8");
}

// Only the blocks defining buttons and the visual widgets: the rest of
// Widgets.md needs a full client (config, views).
async function visualsScript(): Promise<string> {
  const page = await stdPage("Widgets/Widgets.md");
  const blocks = [...page.matchAll(/```space-lua\n([\s\S]*?)```/g)].map(
    (m) => m[1],
  );
  const wanted = ["function widgets.button", "function widgets.chip"];
  const found = wanted.map((w) => blocks.find((b) => b.includes(w)));
  if (found.some((b) => !b)) throw new Error("missing widget blocks");
  return found.join("\n");
}

async function visualsEnv() {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set("jsonschema", jsToLuaValue({ validateObject: () => null }));
  env.set(
    "markdown",
    jsToLuaValue({
      markdownToHtml: (md: string) => `<span class="md">${md}</span>`,
    }),
  );
  const run = async (lua: string) => {
    const block = parseBlock(lua);
    try {
      await evalStatement(
        block,
        env,
        LuaStackFrame.createWithGlobalEnv(env, block.ctx),
      );
    } catch (e: any) {
      // Lua errors carry the whole environment; keep only the message so the
      // test worker can report it.
      throw new Error(String(e?.message ?? e));
    }
  };
  await run(extractSpaceLuaFromPageText(await stdPage("APIs/DOM.md")));
  await run(extractSpaceLuaFromPageText(await stdPage("APIs/Widget.md")));
  await run(await visualsScript());
  // The widget's element: built with the DOM builder, not an HTML string
  const el = async (expr: string): Promise<HTMLElement> => {
    await run(`__w = ${expr}`);
    const w = env.get("__w") as LuaTable;
    expect(w.rawGet("_isWidget")).toBe(true);
    const html = w.rawGet("html");
    expect(typeof html).not.toBe("string");
    expect((html as Node).nodeType).toBe(1);
    return html as HTMLElement;
  };
  const display = (): string | undefined =>
    (env.get("__w") as LuaTable).rawGet("display");
  return { run, el, display, env };
}

const TRICKY = "<b>x</b> **y** [[Link]] #tag ${1} & 'q'";
const TRICKY_LUA = JSON.stringify(TRICKY);

test("widgets.chip shows its label literally with the neutral tone by default", async () => {
  const { el, display } = await visualsEnv();
  const chip = await el(`widgets.chip(${TRICKY_LUA})`);
  expect(chip.tagName).toBe("SPAN");
  expect(chip.getAttribute("class")).toBe("sb-chip sb-tone-neutral");
  expect(chip.textContent).toBe(TRICKY);
  expect(chip.children).toHaveLength(0);
  expect(display()).toBeUndefined();
});

test("widgets.chip applies tone and title, and is not clickable without onClick", async () => {
  const { el } = await visualsEnv();
  const chip = await el(
    `widgets.chip("Open", { tone = "success", title = "Go <there>", page = "Old" })`,
  );
  expect(chip.tagName).toBe("SPAN");
  expect(chip.getAttribute("class")).toBe("sb-chip sb-tone-success");
  expect(chip.getAttribute("title")).toBe("Go <there>");
  expect(chip.hasAttribute("role")).toBe(false);
  expect(chip.hasAttribute("data-ref")).toBe(false);
});

test("widgets.chip with onClick is a button: click and Enter run the handler", async () => {
  const { el, run, env } = await visualsEnv();
  const chip = await el(
    `widgets.chip("Go", { onClick = function() hits = (hits or 0) + 1 end })`,
  );
  expect(chip.getAttribute("role")).toBe("button");
  expect(chip.getAttribute("tabindex")).toBe("0");
  chip.click();
  chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  chip.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  await run("");
  expect(env.get("hits")).toBe(2);
});
// happy-dom's CSS.supports accepts any value (and hands out a new CSS object
// on every access); real browsers check it. Replace it for the test.
function cssColours(valid: string[]) {
  vi.stubGlobal("CSS", {
    supports: (_prop: string, value: string) => valid.includes(value),
  });
  return { mockRestore: () => vi.unstubAllGlobals() };
}

test("widgets.chip falls back to neutral for an unknown tone", async () => {
  const supports = cssColours(["#c0603a"]);
  const { el } = await visualsEnv();
  // tone takes names only; a colour goes in `color`
  const chip = await el(`widgets.chip("x", { tone = "#c0603a" })`);
  expect(chip.getAttribute("class")).toBe("sb-chip sb-tone-neutral");
  expect(chip.style.getPropertyValue("--sb-tone")).toBe("");
  supports.mockRestore();
});

test("widgets.chip takes a CSS colour in `color`, over its tone", async () => {
  const supports = cssColours(["#c0603a"]);
  const { el } = await visualsEnv();
  const chip = await el(
    `widgets.chip("x", { tone = "danger", color = "#c0603a" })`,
  );
  expect(chip.getAttribute("class")).toBe("sb-chip sb-tone-custom");
  expect(chip.style.getPropertyValue("--sb-tone")).toBe("#c0603a");
  expect(chip.style.getPropertyValue("--sb-tone-soft")).toBe(
    "color-mix(in srgb, #c0603a 16%, transparent)",
  );
  supports.mockRestore();
});

test("widgets.chip ignores an invalid `color` and keeps its tone", async () => {
  const supports = cssColours([]);
  const { el } = await visualsEnv();
  const chip = await el(
    `widgets.chip("x", { tone = "danger", color = "notacolour" })`,
  );
  expect(chip.getAttribute("class")).toBe("sb-chip sb-tone-danger");
  expect(chip.style.getPropertyValue("--sb-tone")).toBe("");
  supports.mockRestore();
});

test("widgets.stat and widgets.bars take `color` too, bars per row", async () => {
  const supports = cssColours(["teal", "rgb(10, 20, 30)", "#123456"]);
  const { el } = await visualsEnv();
  const stat = await el(`widgets.stat("n", 1, { color = "teal" })`);
  expect(stat.classList.contains("sb-tone-custom")).toBe(true);
  expect(stat.style.getPropertyValue("--sb-tone")).toBe("teal");
  const bars = await el(`widgets.bars({
    { label = "a", value = 1, c = "rgb(10, 20, 30)" },
    { label = "b", value = 2, tone = "danger" },
    { label = "c", value = 3, color = "#123456" },
  }, { color = function(r) return r.c end })`);
  const rows = [...bars.querySelectorAll<HTMLElement>(".sb-bars-row")];
  expect(rows.map((r) => r.getAttribute("class"))).toEqual([
    "sb-bars-row sb-tone-custom",
    "sb-bars-row sb-tone-danger",
    "sb-bars-row sb-tone-accent",
  ]);
  expect(rows[0].style.getPropertyValue("--sb-tone")).toBe("rgb(10, 20, 30)");
  // Without opts.color, a row's own `color` field is used
  const own = await el(
    `widgets.bars({ { label = "c", value = 3, color = "#123456" } })`,
  );
  expect(
    own
      .querySelector<HTMLElement>(".sb-bars-row")
      ?.style.getPropertyValue("--sb-tone"),
  ).toBe("#123456");
  supports.mockRestore();
});

test("widgets.bars scales widths to the largest value and shows labels literally", async () => {
  const { el, display } = await visualsEnv();
  const bars = await el(`widgets.bars {
    { label = "<i>open</i>", value = 4 },
    { label = "closed", value = 2 },
  }`);
  expect(bars.getAttribute("class")).toBe("sb-bars");
  const rows = bars.querySelectorAll(".sb-bars-row");
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector(".sb-bars-label")?.textContent).toBe(
    "<i>open</i>",
  );
  expect(bars.querySelector("i")).toBeNull();
  const fills = [...bars.querySelectorAll<HTMLElement>(".sb-bars-fill")];
  expect(fills.map((f) => f.style.width)).toEqual(["100%", "50%"]);
  expect(rows[0].querySelector(".sb-bars-value")?.textContent).toBe("4");
  expect(display()).toBe("block");
});

test("widgets.bars takes field names, functions, max, tone and onClick(row)", async () => {
  const { el, run, env } = await visualsEnv();
  const bars = await el(`widgets.bars({
    { name = "Alpha", count = 1, state = "blocked" },
    { name = "Beta", count = 3, state = "done" },
  }, {
    label = "name",
    value = function(r) return r.count end,
    tone = function(r) return r.state == "blocked" and "danger" or "success" end,
    max = 4,
    onClick = function(r) picked = r.name end,
  })`);
  const fills = [...bars.querySelectorAll<HTMLElement>(".sb-bars-fill")];
  expect(fills.map((f) => f.style.width)).toEqual(["25%", "75%"]);
  const rows = [...bars.querySelectorAll(".sb-bars-row")];
  expect(rows.map((r) => r.getAttribute("class"))).toEqual([
    "sb-bars-row sb-tone-danger",
    "sb-bars-row sb-tone-success",
  ]);
  expect(rows[1].getAttribute("role")).toBe("button");
  (rows[1] as HTMLElement).click();
  await run("");
  expect(env.get("picked")).toBe("Beta");
});

test("widgets.bars renders an empty state for no rows", async () => {
  const { el } = await visualsEnv();
  const bars = await el("widgets.bars({})");
  expect(bars.getAttribute("class")).toBe("sb-empty");
});

test("widgets.bars handles all-zero values without dividing by zero", async () => {
  const { el } = await visualsEnv();
  const bars = await el(`widgets.bars { { label = "a", value = 0 } }`);
  expect(bars.querySelector<HTMLElement>(".sb-bars-fill")?.style.width).toBe(
    "0%",
  );
});

test("widgets.stat shows label, value, caption and a clamped bar", async () => {
  const { el, display } = await visualsEnv();
  const stat = await el(
    `widgets.stat("Open <tickets>", 12, { tone = "warning", sub = "**3** new", bar = 1.7 })`,
  );
  expect(stat.tagName).toBe("DIV");
  expect(stat.getAttribute("class")).toBe("sb-stat sb-tone-warning");
  expect(stat.querySelector(".sb-stat-label")?.textContent).toBe(
    "Open <tickets>",
  );
  expect(stat.querySelector(".sb-stat-value")?.textContent).toBe("12");
  expect(stat.querySelector(".sb-stat-sub")?.textContent).toBe("**3** new");
  expect(
    stat.querySelector<HTMLElement>(".sb-stat-bar > span")?.style.width,
  ).toBe("100%");
  expect(display()).toBe("block");
});

test("widgets.stat with onClick is a button that runs it", async () => {
  const { el, run, env } = await visualsEnv();
  const stat = await el(
    `widgets.stat("Done", 3, { onClick = function() opened = "Done" end })`,
  );
  expect(stat.tagName).toBe("DIV");
  expect(stat.getAttribute("role")).toBe("button");
  stat.click();
  await run("");
  expect(env.get("opened")).toBe("Done");
});
test("widgets.grid lays out the widgets returned by the item function", async () => {
  const { el, display } = await visualsEnv();
  const grid =
    await el(`widgets.grid({ { n = "A", v = 1 }, { n = "B", v = 2 } },
    function(it) return widgets.stat(it.n, it.v) end, { min = "9rem" })`);
  expect(grid.getAttribute("class")).toBe("sb-grid");
  expect(grid.style.getPropertyValue("--sb-grid-min")).toBe("9rem");
  expect(grid.querySelectorAll(".sb-stat")).toHaveLength(2);
  expect(display()).toBe("block");
});

test("widgets.grid uses items as widgets without a function, and shows strings literally", async () => {
  const { el } = await visualsEnv();
  const grid = await el(`widgets.grid { widgets.chip("a"), "<b>plain</b>" }`);
  expect(grid.querySelector(".sb-chip")).not.toBeNull();
  expect(grid.querySelector(".sb-grid-text")?.textContent).toBe("<b>plain</b>");
  expect(grid.querySelector("b")).toBeNull();
});

test("widgets.grid renders an empty state for no items", async () => {
  const { el } = await visualsEnv();
  const grid = await el("widgets.grid({})");
  expect(grid.getAttribute("class")).toBe("sb-empty");
});

test("widgets.grid keeps DOM-built cells and their click handlers", async () => {
  const { el, run, env } = await visualsEnv();
  const grid = await el(`widgets.grid({ "a", "b" }, function(x)
    return widgets.button("Press " .. x, function() clicked = x end)
  end)`);
  const buttons = grid.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  (buttons[1] as HTMLElement).click();
  await run("");
  expect(env.get("clicked")).toBe("b");
});
