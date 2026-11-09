import { expect, test } from "vitest";
import { loadConfig } from "./boot_config.ts";
import { extractSpaceLuaFromPageText } from "./space_lua_blocks_test_util.ts";

test("Test boot config", () => {
  expect(
    extractSpaceLuaFromPageText("Hello\n\n```space-lua\ntest()\n```\nMore"),
  ).toEqual("test()");
  expect(
    extractSpaceLuaFromPageText(
      "Hello\n\n```space-lua\ntest()\n```\nMore\n\n```space-lua\ntest2()\n```",
    ),
  ).toEqual("test()\ntest2()");
  expect(
    extractSpaceLuaFromPageText("Hello\n\n```lua\ntest()\n```\nMore"),
  ).toEqual("");
  expect(
    extractSpaceLuaFromPageText(
      "```space-lua\nlive = 1\n```\n\n<!--\n\n```space-lua\ncommented = 2\n```\n\n-->\n",
    ),
  ).toEqual("live = 1");
});

test("Test CONFIG lua eval", async () => {
  let config = await loadConfig([], {}, false);
  expect(config.values).toEqual({});

  config = await loadConfig(
    [
      {
        ref: "CONFIG@0",
        code: `
    config.set {
      option1 = "pete"
    }
    config.set("optionObj.nested", 5)
`,
      },
    ],
    {},
    false,
  );
  expect(config.values).toEqual({
    option1: "pete",
    optionObj: {
      nested: 5,
    },
  });

  config = await loadConfig(
    [
      {
        ref: "CONFIG@0",
        code: `
    config.set {
      option1 = "pete"
    }
    slashCommand.define {}
    local shouldSet = true
    if shouldSet then
      config.set("optionObj.nested", 5)
    end
`,
      },
    ],
    {},
    false,
  );
  expect(config.values).toEqual({
    option1: "pete",
    optionObj: {
      nested: 5,
    },
  });
});

test("loadConfig skips a boot block that fails to parse", async () => {
  const config = await loadConfig(
    [
      { ref: "A@0", code: 'config.set("a", 1)' },
      { ref: "B@0", code: "config.set(" },
      { ref: "C@0", code: 'config.set("c", 3)' },
    ],
    {},
    false,
  );
  expect(config.values).toEqual({ a: 1, c: 3 });
});

test("loadConfig keeps going after a runtime error in a block", async () => {
  const config = await loadConfig(
    [
      { ref: "A@0", code: 'error("boom")\nconfig.set("a", 1)' },
      { ref: "B@0", code: 'config.set("b", 2)' },
    ],
    {},
    false,
  );
  expect(config.values).toEqual({ a: 1, b: 2 });
});
