import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { viewRowsMarkdown } from "../navigator/rows_markdown.ts";
import type { Space } from "../space.ts";
import { evalStatement } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { jsToLuaValue, LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";
import {
  createRenderContext,
  type RenderHost,
  renderMarkdown,
  renderMarkdownStatic,
} from "./compose.ts";

export type TestEnv = {
  env: LuaEnv;
  run(lua: string): Promise<void>;
  space: Space;
  sle: SpaceLuaEnvironment;
  pages: Record<string, string>;
};

async function stdLua(page: string): Promise<string> {
  const text = await readFile(
    path.resolve("libraries/Library/Std", page),
    "utf8",
  );
  return extractSpaceLuaFromPageText(text);
}

// Helpers used by the corpus and the matrix; names mirror the investigation pages.
const HELPERS = `
T = {}
T.pages = { {name = "Alpha"}, {name = "Beta/Gamma"} }
T.tasks = { {name = "Write", state = " ", ref = "Alpha@10"}, {name = "Ship", state = "x", ref = "anchorone"} }
T.tags = { {name = "work"} }
T.records = { {name = "a", n = 1}, {name = "b", n = 2} }
function T.btn(label) return widgets.button(label, function() T.clicked = label end) end
function T.md(s) return widget.markdown(s) end
T.mention = template.new[==[**[[\${_.page}@\${_.start}]]**:
\${_.snippet}

]==]
T.docsSection = template.new[==[## [[\${name}]]
\${description}
]==]
`;

export async function buildTestEnv(
  pages: Record<string, string> = {},
): Promise<TestEnv> {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set("jsonschema", jsToLuaValue({ validateObject: () => null }));
  const run = async (lua: string) => {
    const block = parseBlock(lua);
    try {
      await evalStatement(
        block,
        env,
        LuaStackFrame.createWithGlobalEnv(env, block.ctx),
      );
    } catch (e: any) {
      throw new Error(String(e?.message ?? e));
    }
  };
  await run(await stdLua("APIs/DOM.md"));
  await run(await stdLua("APIs/Widget.md"));
  await run(await stdLua("APIs/Template.md"));
  await run(await stdLua("Infrastructure/Query Templates.md"));
  // Buttons only: the rest of Widgets.md needs a full client.
  const widgetsPage = await readFile(
    path.resolve("libraries/Library/Std/Widgets/Widgets.md"),
    "utf8",
  );
  const buttonBlock = [...widgetsPage.matchAll(/```space-lua\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((b) => b.includes("function widgets.button"))!;
  await run(buttonBlock);
  await run(HELPERS);
  const space = {
    readRef: async (ref: { path: string }) => {
      const name = ref.path.replace(/\.md$/, "");
      if (!(name in pages)) throw new Error(`Not found: ${name}`);
      return { text: pages[name], offset: 0 };
    },
  } as unknown as Space;
  const sle = { env } as unknown as SpaceLuaEnvironment;
  return { env, run, space, sle, pages };
}

export function testHost(
  t: TestEnv,
  overrides: Partial<RenderHost> = {},
): RenderHost {
  return {
    space: t.space,
    sle: t.sle,
    syntaxExtensions: {},
    allPages: [],
    renderOptions: { shortWikiLinks: true },
    createSandbox: () => {
      const el = document.createElement("div");
      el.className = "sandbox-stub";
      return el;
    },
    viewMarkdown: (view) => viewRowsMarkdown(view, t.env),
    ...overrides,
  };
}

// Unwrap slot wrappers so live output compares with the static snapshot.
export function normaliseLive(node: HTMLElement): string {
  for (const w of Array.from(node.querySelectorAll(".sb-slot"))) {
    w.replaceWith(...Array.from(w.childNodes));
  }
  return node.innerHTML;
}

export async function renderCorpusHtml(
  t: TestEnv,
  markdown: string,
  pageName = "Host",
): Promise<string> {
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: pageName },
  });
  return renderMarkdownStatic(markdown, ctx);
}

export async function renderCorpusLive(
  t: TestEnv,
  markdown: string,
  pageName = "Host",
): Promise<string> {
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: pageName },
  });
  return normaliseLive((await renderMarkdown(markdown, ctx)).node);
}
