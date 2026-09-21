import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  luaValueToJS,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

async function run(
  recipient: string | null = "@HELPER",
  limit: number | null = 10,
  own: string | null = "self",
  offset = 0,
  inbox = false,
) {
  const env = new LuaEnv(luaBuildStandardEnv());
  const relations = [
    {
      to: "@helper",
      page: "Review",
      from: "Review@4",
      range: [4, 11],
      by: ["@mira"],
      snippet: "Question",
      fromTag: "paragraph",
      inComment: false,
    },
    {
      to: "@helper",
      page: "Tasks",
      from: "Tasks@8",
      range: [8, 15],
      fromTag: "task",
      inComment: false,
      by: [],
      snippet: "Already done",
    },
    {
      to: "@helper",
      page: "Notes",
      from: "Notes@19",
      range: [19, 26],
      inComment: true,
      fromTag: "paragraph",
      by: [],
      snippet: "Unsigned",
    },
    {
      to: "@garden's-helper",
      page: "Other",
      range: [0, 8],
    },
  ];
  env.set(
    "index",
    jsToLuaValue({
      relations: (type: string) =>
        jsToLuaValue(
          type === "at-mention"
            ? relations
            : [
                {
                  to: "@helper",
                  toTag: "identity",
                  page: "Assigned",
                  snippet: "Whole page",
                },
                { to: "@helper", toTag: "page", page: "Not an identity" },
              ],
        ),
      getObjectByRef: () => jsToLuaValue({ done: true }),
    }),
  );
  env.set(
    "system",
    jsToLuaValue({
      listAccounts: () =>
        jsToLuaValue(own ? [{ me: true, username: own }] : []),
      invokeFunction: () =>
        jsToLuaValue([
          { id: "@mira", name: "Mira" },
          ...(own ? [{ id: `@${own}`, name: own }] : []),
        ]),
    }),
  );
  env.set("recipient", jsToLuaValue(recipient));
  env.set("options", jsToLuaValue({ limit, offset }));
  const markdown = readFileSync(
    new URL("../../libraries/Library/Std/APIs/Identity.md", import.meta.url),
    "utf8",
  );
  let code =
    [...markdown.matchAll(/```space-lua\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .join("\n") + "\nreturn identity.mentions(recipient, options)";
  if (inbox) {
    const inboxMarkdown = readFileSync(
      new URL(
        "../../libraries/Library/Std/Editor/Mention Inbox.md",
        import.meta.url,
      ),
      "utf8",
    );
    code =
      code.replace("return identity.mentions(recipient, options)", "") +
      "\nlocal definition\nview = {define = function(spec) definition = spec end}\n" +
      [...inboxMarkdown.matchAll(/```space-lua\n([\s\S]*?)```/g)]
        .map((match) => match[1])
        .join("\n") +
      "\nreturn definition.source()";
  }
  const sf = LuaStackFrame.createWithGlobalEnv(env);
  try {
    const result = await evalStatement(parseBlock(code), env, sf, true);
    if (result?.ctrl !== "return") throw new Error("Expected a return value");
    return luaValueToJS(result.values[0], sf);
  } catch (error) {
    throw new Error(
      error instanceof LuaRuntimeError
        ? error.toPrettyString(code)
        : String(error),
    );
  }
}

test("mentions retain authors, UTF-16 refs, comments and page recipients, excluding completed tasks", async () => {
  const result = await run();
  expect(result.total).toBe(3);
  expect(result.truncated).toBe(false);
  expect(result.mentions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        page: "Review",
        pos: 4,
        ref: "Review@4",
        by: ["Mira"],
        replyTo: "Mira",
      }),
      expect.objectContaining({
        page: "Notes",
        inComment: true,
        replyTo: "self",
      }),
      expect.objectContaining({
        page: "Assigned",
        kind: "page",
        replyTo: "self",
      }),
    ]),
  );
});

test("limits report truncation and unknown identity never invents a recipient", async () => {
  const result = await run("helper", 1, null);
  expect(result.total).toBe(3);
  expect(result.mentions).toHaveLength(1);
  expect(result.truncated).toBe(true);
  const anonymous = await run("helper", 10, null);
  expect(
    anonymous.mentions.find((item: { page: string }) => item.page === "Notes")
      .replyTo,
  ).toBeUndefined();
});

test("invalid input fails before looking up mentions", async () => {
  await expect(run("bad name")).rejects.toThrow("invalid recipient");
  await expect(run("@")).rejects.toThrow("invalid recipient");
  await expect(run("helper", 0)).rejects.toThrow();
});

test("apostrophes in indexed identities are supported", async () => {
  const result = await run("garden's-helper");
  expect(result.total).toBe(1);
  expect(result.mentions[0].page).toBe("Other");
});

test("pagination preserves order and reports remaining matches", async () => {
  const result = await run("helper", 1, "self", 1);
  expect(result.mentions[0].page).toBe("Notes");
  expect(result.total).toBe(3);
  expect(result.truncated).toBe(true);
  expect((await run("helper", 1, "self", 2)).truncated).toBe(false);
  expect(
    Object.keys((await run("helper", 1, "self", 9)).mentions),
  ).toHaveLength(0);
  await expect(run("helper", 1, "self", -1)).rejects.toThrow();
});

test("omitted recipient and limit include all recipients for the inbox", async () => {
  const result = await run(null, null);
  expect(result.total).toBe(4);
  expect(result.mentions).toHaveLength(4);
  expect(result.truncated).toBe(false);
  expect(
    result.mentions.find((m: { page: string }) => m.page === "Review"),
  ).toMatchObject({ target: "@helper", range: [4, 11] });
  expect((await run("nobody")).total).toBe(0);
});

test("Mention Inbox consumes the shared API and preserves navigation and authors", async () => {
  const rows = await run(null, null, "self", 0, true);
  expect(rows).toHaveLength(4);
  expect(rows.find((m: { page: string }) => m.page === "Other")).toMatchObject({
    snippet: "@garden's-helper",
  });
  expect(rows.find((m: { page: string }) => m.page === "Review")).toMatchObject(
    {
      ref: "Review@4",
      range: [4, 11],
      by: "@Mira",
      target: "@helper",
      declared: false,
    },
  );
  expect(
    rows.find((m: { page: string }) => m.page === "Assigned"),
  ).toMatchObject({ ref: "Assigned", declared: true, recipient: "@helper" });
});
