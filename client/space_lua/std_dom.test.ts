// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { jsToLuaValue, LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// The Std DOM builder (Library/Std/APIs/DOM.md) running against happy-dom.
async function domEnv() {
  const env = new LuaEnv(luaBuildStandardEnv());
  // String children render as markdown; mark them so tests can see where.
  env.set(
    "markdown",
    jsToLuaValue({
      markdownToHtml: (md: string) => `<span class="md">${md}</span>`,
    }),
  );
  const run = async (lua: string) => {
    const block = parseBlock(lua);
    await evalStatement(
      block,
      env,
      LuaStackFrame.createWithGlobalEnv(env, block.ctx),
    );
  };
  // happy-dom replaces import.meta.url's scheme; tests run from the repo root.
  const page = await readFile(
    path.resolve("libraries/Library/Std/APIs/DOM.md"),
    "utf8",
  );
  await run(extractSpaceLuaFromPageText(page));
  const el = async (expr: string): Promise<HTMLElement> => {
    try {
      await run(`__el = ${expr}`);
    } catch (e: any) {
      // Lua errors carry the whole environment; keep only the message so the
      // test worker can report it.
      throw new Error(String(e?.message ?? e));
    }
    return env.get("__el") as HTMLElement;
  };
  return { el, run };
}

test("dom.text adds literal text, in order among the other children", async () => {
  const { el } = await domEnv();
  const span = await el(
    `dom.span { "a", dom.text("<b>**x**</b> [[L]] \${1}"), "b" }`,
  );
  expect(span.outerHTML).toBe(
    '<span><span class="md">a</span>&lt;b&gt;**x**&lt;/b&gt; [[L]] ${1}<span class="md">b</span></span>',
  );
});

test("class takes a list, skipping false entries", async () => {
  const { el } = await domEnv();
  const span = await el(
    `dom.span { class = { "sb-chip", false, "sb-tone-danger" } }`,
  );
  expect(span.getAttribute("class")).toBe("sb-chip sb-tone-danger");
});

test("style takes a table of CSS properties, custom properties included", async () => {
  const { el } = await domEnv();
  const div = await el(
    `dom.div { style = { width = "33%", ["--sb-grid-min"] = "9rem" } }`,
  );
  expect(div.style.width).toBe("33%");
  expect(div.style.getPropertyValue("--sb-grid-min")).toBe("9rem");
});

test("a list of children is flattened and false children are skipped", async () => {
  const { el } = await domEnv();
  const ul = await el(`dom.ul {
    { dom.li { dom.text("a") }, dom.li { dom.text("b") } },
    false,
    dom.li { dom.text("c") },
  }`);
  expect(ul.outerHTML).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
});

test("existing forms keep working: string class and style, __rawText", async () => {
  const { el } = await domEnv();
  const div = await el(
    `dom.div { class = "a b", style = "color:red", __rawText = "1. raw" }`,
  );
  expect(div.getAttribute("class")).toBe("a b");
  expect(div.getAttribute("style")).toBe("color:red");
  expect(div.textContent).toBe("1. raw");
});
