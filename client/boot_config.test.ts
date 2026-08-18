import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText, loadConfig } from "./boot_config.ts";

test("Test boot config", () => {
  // One block present
  expect(
    extractSpaceLuaFromPageText("Hello\n\n```space-lua\ntest()\n```\nMore"),
  ).toEqual("test()");
  // Two blocks present
  expect(
    extractSpaceLuaFromPageText(
      "Hello\n\n```space-lua\ntest()\n```\nMore\n\n```space-lua\ntest2()\n```",
    ),
  ).toEqual("test()\ntest2()");
  // No lua present
  expect(
    extractSpaceLuaFromPageText("Hello\n\n```lua\ntest()\n```\nMore"),
  ).toEqual("");
  // A commented-out block is disabled
  expect(
    extractSpaceLuaFromPageText(
      "```space-lua\nlive = 1\n```\n\n<!--\n\n```space-lua\ncommented = 2\n```\n\n-->\n",
    ),
  ).toEqual("live = 1");
});

test("Test CONFIG lua eval", async () => {
  // Test base case: no config code
  let config = await loadConfig("", {}, false);
  expect(config.values).toEqual({});

  // Check a few config sets
  config = await loadConfig(
    `
    config.set {
      option1 = "pete"
    }
    config.set("optionObj.nested", 5)
`,
    {},
    false,
  );
  expect(config.values).toEqual({
    option1: "pete",
    optionObj: {
      nested: 5,
    },
  });

  // Check random Lua code crap resilience
  config = await loadConfig(
    `
    config.set {
      option1 = "pete"
    }
    slashCommand.define {}
    local shouldSet = true
    if shouldSet then
      config.set("optionObj.nested", 5)
    end
`,
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
