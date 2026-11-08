import { markdownSyscalls } from "../plugos/syscalls/markdown.ts";
import type { Client } from "../client.ts";
import { renderLuaCallback } from "./render_widget.ts";
import { pageVarsSyscalls } from "../plugos/syscalls/page_vars.ts";
import { readFile } from "node:fs/promises";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { luaValueToJS } from "./runtime.ts";
import { renderThread } from "./render_thread.ts";
import { expect, test } from "vitest";
import { System } from "../plugos/system.ts";
import { evalStatement } from "./eval.ts";
import { PageScopes, assignmentRenderValue } from "./page_scope.ts";
import { parseBlock } from "./parse.ts";
import {
  installRestrictedContext,
  restrictedContext,
} from "./restricted_context.ts";
import { LuaEnv, LuaStackFrame, LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

function setup() {
  const env = new LuaEnv(luaBuildStandardEnv());
  installRestrictedContext(env, new System());
  return env;
}

test("assignment rendering rejects executable tables from ordinary pages", async () => {
  const env = setup();
  const scopes = new PageScopes({
    spaceEnv: () => env,
    readPageText: async () =>
      '${card = {_isWidget=true, html="<b>unexpected</b>"}}',
  });
  const scope = await scopes.get("Notebook");
  expect(assignmentRenderValue(scope, "card")).toContain(
    "Only installed widgets",
  );
});

test("only annotated functions from protected sources are exposed", async () => {
  const env = setup();
  for (const [name, ref] of [
    ["installed", "Library/Cards.md"],
    ["ordinary", "Notebook.md"],
  ]) {
    const block = parseBlock(
      `--- @capabilities space:read\nfunction ${name}() return {label="Ready"} end`,
      { ref },
    );
    await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  }
  const context = restrictedContext(env, "Notebook")!;
  expect(await context.run("return installed().label")).toBe("Ready");
  await expect(context.run("return ordinary()")).rejects.toThrow();
  expect(restrictedContext(env, "Library/Cards")).toBeUndefined();
});

test("trusted widget assignment unwraps only at the render boundary", async () => {
  const env = setup();
  const block = parseBlock(
    '--- @capabilities widget:render\nfunction card() return {_isWidget=true, html="<b>Ready</b>"} end',
    { ref: "Library/Cards.md" },
  );
  await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  const scopes = new PageScopes({
    spaceEnv: () => env,
    readPageText: async () => "${badge = card()}",
  });
  const value = assignmentRenderValue(await scopes.get("Notebook"), "badge");
  expect(value).toBeInstanceOf(LuaTable);
  expect((value as LuaTable).rawGet("html")).toBe("<b>Ready</b>");
});

test("concurrent renders keep their page context and dependency tracking separate", async () => {
  const env = setup();
  const parent = restrictedContext(env, "Notebook")!.env;
  const first = renderThread(env, null, {
    parentEnv: parent,
    currentPage: { name: "First" },
  });
  const second = renderThread(env, null, {
    parentEnv: parent,
    currentPage: { name: "Second" },
  });
  expect(first.sf.threadLocal.get("currentPage").rawGet("name")).toBe("First");
  expect(first.sf.threadState).not.toBe(second.sf.threadState);
  expect(first.sf.threadState.restrictedPolicy).toBe(
    second.sf.threadState.restrictedPolicy,
  );
});

test("bundled subpage widget is available to ordinary expressions", async () => {
  const env = setup();
  const text = await readFile(
    "libraries/Library/Std/Widgets/Widgets.md",
    "utf8",
  );
  const source = extractSpaceLuaFromPageText(text).split(
    "config.defineCategory",
  )[0];
  const block = parseBlock(source, { ref: "Library/Std/Widgets/Widgets.md" });
  env.setLocal("widgets", new LuaTable());
  await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  const context = restrictedContext(env, "Notebook")!;
  expect(context.inventory).toContain("widgets.subPages");
  expect(context.inventory).not.toContain("widgets.commandButton");
  expect(context.inventory).not.toContain("widgets.button");
});

test("page variable reads preserve dependency tracking without exporting callbacks", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  const system = new System();
  const scopes = new PageScopes({
    spaceEnv: () => env,
    readPageText: async () =>
      "${rate = 5}\n```page-lua\nfunction helper() return 1 end\n```",
  });
  system.registerSyscalls(
    [],
    pageVarsSyscalls(scopes, {
      currentPage: () => "Notebook",
      editPage: async () => {
        throw new Error("Unexpected write");
      },
    }),
  );
  installRestrictedContext(env, system);
  const context = restrictedContext(env, "Report")!;
  const tracked: string[] = [];
  context.sf.threadState.track = (event) => {
    tracked.push(event);
  };
  expect(
    await context
      .run('return pageVars.get("rate", "Notebook")')
      .catch((e) => e.message),
  ).toBe(5);
  expect(tracked).toContain("pageScope:changed:Notebook");
  await expect(
    context.run('return pageVars.get("helper", "Notebook")'),
  ).rejects.toThrow("non-data");
});

test.each([false, true])(
  "installed code-widget callbacks render through config conversion: %s",
  async (converted) => {
    const env = setup();
    const block = parseBlock(
      "function installed(body) return {_isWidget=true, html=string.upper(body)} end",
      { ref: "Library/Cards.md" },
    );
    await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
    const client = {
      clientSystem: { spaceLuaEnv: { env } },
    } as unknown as Client;
    const result = await renderLuaCallback(
      client,
      converted
        ? luaValueToJS(
            env.get("installed"),
            LuaStackFrame.createWithGlobalEnv(env),
          )
        : env.get("installed"),
      ["ready"],
      { name: "Notebook" },
    );
    expect(result).toBeInstanceOf(LuaTable);
    expect((result as LuaTable).rawGet("html")).toBe("READY");
  },
);

test("query link columns work through the annotated Markdown adapter", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  const system = new System();
  system.registerSyscalls([], markdownSyscalls({} as Client));
  installRestrictedContext(env, system);
  expect(
    await restrictedContext(env, "Notebook")!
      .run('return markdown.link("Notebook")')
      .catch((e) => e.message),
  ).toBe("[[Notebook]]");
});

test("bundled query templates remain available through reviewed exports", async () => {
  const env = setup();
  for (const name of ["APIs/Template", "Infrastructure/Query Templates"]) {
    const text = await readFile(`libraries/Library/Std/${name}.md`, "utf8");
    const block = parseBlock(extractSpaceLuaFromPageText(text), {
      ref: `Library/Std/${name}.md`,
    });
    await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  }
  expect(
    await restrictedContext(env, "Notebook")!
      .run('return templates.pageItem({name="Notebook"})')
      .catch((e) => e.message),
  ).toBe("* [[Notebook]]\n");
});

test("unexposed installed APIs explain the restriction without running the function", async () => {
  const env = setup();
  const block = parseBlock(
    'widgets = {}\nfunction widgets.commandButton(name) error("must not run") end',
    { ref: "Library/Buttons.md" },
  );
  await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  const context = restrictedContext(env, "Notebook")!;
  await expect(
    context.run('return widgets.commandButton("Navigate: Tag Picker")'),
  ).rejects.toThrow(
    "widgets.commandButton is not available in restricted expressions",
  );
  expect(context.inventory).not.toContain("widgets.commandButton");
});
