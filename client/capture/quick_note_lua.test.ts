import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { jsToLuaValue, LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";

test("the bundled Quick Note capture service saves the edited draft and linked files", async () => {
  const source = await readFile(
    new URL("../../libraries/Library/Std/APIs/Capture.md", import.meta.url),
    "utf8",
  );
  const code = extractSpaceLuaFromPageText(source);
  const env = new LuaEnv(luaBuildStandardEnv());
  const services: Array<{
    selector: string;
    match: (data: unknown) => Promise<{ name: string } | null>;
    run: (data: unknown) => Promise<void>;
  }> = [];
  const pages = new Map<string, string>();
  const files = new Map<string, string>();
  let navigated: string | undefined;
  env.set(
    "service",
    jsToLuaValue({
      define: (spec: (typeof services)[number]) => services.push(spec),
    }),
  );
  env.set(
    "config",
    jsToLuaValue({
      defineCategory: () => undefined,
      define: () => undefined,
      get: (key: string, fallback: unknown) =>
        key === "maximumDocumentSize" ? 10 : fallback,
    }),
  );
  env.set(
    "space",
    jsToLuaValue({
      pageExists: (name: string) => pages.has(name),
      readPage: (name: string) => pages.get(name),
      writePage: (name: string, content: string) => {
        pages.set(name, content);
      },
    }),
  );
  env.set(
    "capture",
    jsToLuaValue({
      saveFile: (handle: string, path: string) => {
        files.set(path, handle);
        return true;
      },
    }),
  );
  env.set(
    "editor",
    jsToLuaValue({
      navigate: (page: string) => {
        navigated = page;
      },
    }),
  );
  const block = parseBlock(code);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  await evalStatement(block, env, frame);

  const service = services.find((entry) => entry.selector === "capture");
  expect(service).toBeDefined();
  const data = {
    id: "a1b2c3d4-0000-4000-8000-000000000000",
    receivedAt: Date.UTC(2026, 8, 25, 10, 2, 3),
    title: "Edited title",
    text: "Edited body",
    url: "https://example.test/story",
    files: [{ handle: "one", name: "sample file.bin", size: 3 }],
  };
  const found = await service!.match(data);
  expect(found?.name).toBe("Save as Quick Note");
  await service!.run(data);

  expect(navigated).toMatch(/^Inbox\/2026-09-25\/10-02-03-/);
  expect(pages.get(navigated!)).toContain("Edited title\n\nEdited body");
  expect(pages.get(navigated!)).toContain("https://example.test/story");
  expect([...files.values()]).toEqual(["one"]);
  expect(pages.get(navigated!)).toContain([...files.keys()][0]);
});
