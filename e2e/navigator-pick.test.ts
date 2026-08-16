import { expect, test } from "./fixtures.ts";
import {
  navFrame,
  navInput,
  navSegment,
  runCommandViaPalette,
} from "./navigator-ui.ts";
import type { Page } from "@playwright/test";

const PICK_CONFIG = `# Pick test fixtures
\`\`\`space-lua
command.define {
  name = "Navigator: Pick Basic",
  run = function()
    local obj = navigator.pick {
      title = "Pick Basic",
      placeholder = "Pick a fruit",
      source = function()
        return {
          { name = "Apple", ref = "Apple" },
          { name = "Banana", ref = "Banana" },
        }
      end,
    }
    return obj and obj.name or nil
  end,
}

pickLog = {}

command.define {
  name = "Navigator: Pick With Create",
  run = function()
    local obj = navigator.pick {
      title = "Pick or Create",
      placeholder = "Pick or create",
      source = function()
        return { { name = "Existing", ref = "Existing" } }
      end,
      onCreate = function(phrase) pickLog.created = phrase end,
    }
    return obj and obj.name or nil
  end,
}

command.define {
  name = "Navigator: Pick With Segments",
  run = function()
    local obj = navigator.pick {
      title = "Pick Segmented",
      placeholder = "Pick",
      segments = {
        { label = "All", default = true },
        { label = "Odd", where = function(o) return o.odd == true end },
      },
      source = function()
        return {
          { name = "One", ref = "One", odd = true },
          { name = "Two", ref = "Two", odd = false },
        }
      end,
    }
    return obj and obj.name or nil
  end,
}

command.define {
  name = "Navigator: Pick Super A",
  run = function()
    local obj = navigator.pick {
      title = "Pick Super A",
      placeholder = "Super A",
      source = function() return { { name = "OnlyA", ref = "OnlyA" } } end,
    }
    return obj and obj.name or nil
  end,
}

command.define {
  name = "Navigator: Pick Super B",
  run = function()
    local obj = navigator.pick {
      title = "Pick Super B",
      placeholder = "Super B",
      source = function() return { { name = "OnlyB", ref = "OnlyB" } } end,
    }
    return obj and obj.name or nil
  end,
}

command.define {
  name = "Navigator: Pick OnSelect False Once",
  run = function()
    local obj = navigator.pick {
      title = "Pick OnSelect False Once",
      placeholder = "Pick twice",
      source = function()
        return {
          { name = "First", ref = "First" },
          { name = "Second", ref = "Second" },
        }
      end,
      -- Unchanged semantics: "First" keeps the panel open (and the pick
      -- unresolved) the first time it's picked; anything else -- including
      -- picking "Second", or picking "First" again -- resolves normally.
      onSelect = function(picked, ctx)
        if picked.name == "First" then return false end
      end,
    }
    return obj and obj.name or nil
  end,
}

-- A named view (not a pick) to open over a pending pick, so the supersede
-- path is exercised through navigator.open's own meta.dock lookup rather
-- than pick-over-pick's.
navigator.define {
  name = "pickSuperNamed",
  title = "Pick Super Named",
  command = "Navigator: Pick Super Named",
  dock = "modal",
  presentation = { mode = "list" },
  source = function() return { { name = "NamedRow", ref = "NamedRow" } } end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

-- Validation: every navigator.define ("name-world") field navigator.pick
-- rejects outright, plus the exact message for one of them (the rest just
-- check pass/fail, like the existing prefix-validation suite does).
--
-- These pcall()s run at space-lua *load* time, which is only safe because
-- every case here is expected to be rejected before navigator.pick ever
-- reaches its suspending call (system.invokeFunction("navigator.pickOpen",
-- ...)). If a rejection ever regressed to actually opening a picker, this
-- script would suspend waiting for a user who isn't there, and the whole
-- file would time out on load instead of failing with a readable assertion.
local rejectFieldCases = {
  { field = "name", value = "x" },
  { field = "command", value = "X" },
  { field = "key", value = "k" },
  { field = "mac", value = "k" },
  { field = "menu", value = "File" },
  { field = "menuMac", value = "File" },
  { field = "menuWindows", value = "File" },
  { field = "menuLinux", value = "File" },
  { field = "hide", value = true },
  { field = "dock", value = "lhs" },
  { field = "openOnStart", value = true },
  { field = "refreshOn", value = {} },
  { field = "refreshOnOpen", value = true },
  { field = "followEditor", value = true },
  { field = "onMove", value = function() end },
  { field = "prefixViews", value = { ["$"] = "somewhere" } },
}
pickRejectLog = {}
for _, case in ipairs(rejectFieldCases) do
  local spec = { source = function() return {} end }
  spec[case.field] = case.value
  local ok = pcall(navigator.pick, spec)
  pickRejectLog[#pickRejectLog + 1] = case.field .. "=" .. tostring(ok)
end
local nameOk, nameErr = pcall(navigator.pick, {
  name = "x",
  source = function() return {} end,
})
pickRejectLog[#pickRejectLog + 1] = "name.error=" .. tostring(nameErr)

navigator.define {
  name = "pickRejectView",
  title = "Pick Reject Fields",
  command = "Navigator: Pick Reject Fields",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, line in ipairs(pickRejectLog) do
      out[#out + 1] = { name = line, ref = line }
    end
    return out
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

-- Validation: navigator.define rejects the reserved __pick: prefix, and a
-- normal name right next to it still works (so the rejection is about the
-- prefix, not a coincidental break in navigator.define itself).
pickPrefixLog = {}
do
  local reservedOk = pcall(navigator.define, {
    name = "__pick:oops",
    source = function() return {} end,
  })
  pickPrefixLog[#pickPrefixLog + 1] = "reserved=" .. tostring(reservedOk)
  local normalOk = pcall(navigator.define, {
    name = "pickPrefixNormal",
    source = function() return {} end,
    onSelect = function() end,
  })
  pickPrefixLog[#pickPrefixLog + 1] = "normal=" .. tostring(normalOk)
  -- navigator.open rejects the same prefix in the other direction -- this
  -- errors synchronously, before ever reaching the plug, so pcall catches it
  -- without suspending.
  local openOk = pcall(navigator.open, "__pick:probe")
  pickPrefixLog[#pickPrefixLog + 1] = "open=" .. tostring(openOk)
end

navigator.define {
  name = "pickPrefixView",
  title = "Pick Prefix",
  command = "Navigator: Pick Prefix Validation",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    for _, line in ipairs(pickPrefixLog) do
      out[#out + 1] = { name = line, ref = line }
    end
    return out
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}

navigator.define {
  name = "pickReflect",
  title = "Pick Reflect",
  command = "Navigator: Pick Reflect",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    local out = {}
    local keys = {}
    for k, _ in pairs(pickLog) do keys[#keys + 1] = k end
    table.sort(keys)
    for _, k in ipairs(keys) do
      out[#out + 1] = { name = k .. "=" .. tostring(pickLog[k]), ref = k }
    end
    return out
  end,
  onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
}
\`\`\`
`;

test.use({ spaceFiles: { "index.md": "Welcome", "picktest.md": PICK_CONFIG } });

/** Runs a fixture command and returns a promise for its eventual result --
 * not awaited here, since the command suspends on `navigator.pick` until the
 * test drives the modal it opened. */
function invokePickCommand(page: Page, command: string): Promise<unknown> {
  return page.evaluate(
    (cmd) =>
      (globalThis as any).sbRuntime.evalLua(
        `editor.invokeCommand(${JSON.stringify(cmd)})`,
      ),
    command,
  );
}

async function waitForPlaceholder(page: Page, placeholder: string) {
  await expect(navInput(page)).toHaveAttribute("placeholder", placeholder, {
    timeout: 20_000,
  });
}

test("picking a row resolves navigator.pick with that row's object", async ({
  sbPage,
}) => {
  const result = invokePickCommand(sbPage, "Navigator: Pick Basic");
  await waitForPlaceholder(sbPage, "Pick a fruit");
  const frame = navFrame(sbPage);
  await frame.locator(".sb-nav-row", { hasText: "Apple" }).click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  expect(await result).toBe("Apple");
});

test("Escape resolves navigator.pick with nil", async ({ sbPage }) => {
  const result = invokePickCommand(sbPage, "Navigator: Pick Basic");
  await waitForPlaceholder(sbPage, "Pick a fruit");
  await sbPage.keyboard.press("Escape");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  expect(await result).toBeNull();
});

test("a backdrop dismissal resolves navigator.pick with nil", async ({
  sbPage,
}) => {
  const result = invokePickCommand(sbPage, "Navigator: Pick Basic");
  await waitForPlaceholder(sbPage, "Pick a fruit");
  await sbPage
    .locator(".sb-modal-backdrop")
    .click({ position: { x: 5, y: 5 } });
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(0);

  expect(await result).toBeNull();
});

test("a second pick supersedes the first, which resolves nil", async ({
  sbPage,
}) => {
  const frame = navFrame(sbPage);

  const first = invokePickCommand(sbPage, "Navigator: Pick Super A");
  await waitForPlaceholder(sbPage, "Super A");

  const second = invokePickCommand(sbPage, "Navigator: Pick Super B");
  await waitForPlaceholder(sbPage, "Super B");

  // Resolve B for real, so both commands actually finish.
  await frame.locator(".sb-nav-row", { hasText: "OnlyB" }).click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  expect(await first).toBeNull();
  expect(await second).toBe("OnlyB");
});

test("a named navigator.open supersedes a pending pick, which resolves nil", async ({
  sbPage,
}) => {
  const result = invokePickCommand(sbPage, "Navigator: Pick Basic");
  await waitForPlaceholder(sbPage, "Pick a fruit");

  await sbPage.evaluate(() =>
    (globalThis as any).sbRuntime.evalLua(
      'editor.invokeCommand("Navigator: Pick Super Named")',
    ),
  );
  const frame = navFrame(sbPage);
  await expect(frame.locator(".sb-nav-title")).toHaveText("Pick Super Named");

  expect(await result).toBeNull();

  await sbPage.keyboard.press("Escape");
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
});

test("onSelect returning false keeps the pick open and unresolved; a later selection resolves it", async ({
  sbPage,
}) => {
  const result = invokePickCommand(
    sbPage,
    "Navigator: Pick OnSelect False Once",
  );
  await waitForPlaceholder(sbPage, "Pick twice");
  const frame = navFrame(sbPage);

  await frame.locator(".sb-nav-row", { hasText: "First" }).click();
  // Still open: this view's onSelect returned false for "First".
  await expect(
    sbPage.locator(".sb-modal-backdrop:not(.sb-hidden)"),
  ).toHaveCount(1);
  await expect(
    frame.locator(".sb-nav-row", { hasText: "Second" }),
  ).toBeVisible();

  await frame.locator(".sb-nav-row", { hasText: "Second" }).click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  expect(await result).toBe("Second");
});

test("a stale close from an already-resolved pick can never resolve or hide the next pick (sequential picks)", async ({
  sbPage,
}) => {
  const frame = navFrame(sbPage);

  const first = invokePickCommand(sbPage, "Navigator: Pick Super A");
  await waitForPlaceholder(sbPage, "Super A");

  await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    const w = f.contentWindow as any;
    const orig = w.syscall;
    w.syscall = (name: string, ...args: any[]) => {
      if (name === "event.dispatch" && args[0] === "navigator:panelHidden") {
        return new Promise((resolve) => {
          setTimeout(() => resolve(orig(name, ...args)), 500);
        });
      }
      return orig(name, ...args);
    };
  });

  await frame.locator(".sb-nav-row", { hasText: "OnlyA" }).click();

  const second = invokePickCommand(sbPage, "Navigator: Pick Super B");
  await waitForPlaceholder(sbPage, "Super B");

  await frame.locator(".sb-nav-row", { hasText: "OnlyB" }).click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  expect(await first).toBe("OnlyA");
  expect(await second).toBe("OnlyB");
});

test("a plug reload mid-pick resolves navigator.pick with nil, not a hang or a raw error", async ({
  sbPage,
}) => {
  await sbPage.evaluate(() => {
    const client = (globalThis as any).client;
    (globalThis as any).__pluginsReloaded = false;
    const orig = client.dispatchAppEvent.bind(client);
    client.dispatchAppEvent = (name: string, ...args: unknown[]) => {
      if (name === "plugs:loaded") (globalThis as any).__pluginsReloaded = true;
      return orig(name, ...args);
    };
  });

  const result = invokePickCommand(sbPage, "Navigator: Pick Basic");
  await waitForPlaceholder(sbPage, "Pick a fruit");

  void sbPage
    .evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        'editor.invokeCommand("Plugs: Reload")',
      ),
    )
    .catch(() => {});

  await sbPage.waitForFunction(
    () => (globalThis as any).__pluginsReloaded === true,
    { timeout: 20_000 },
  );

  expect(await result).toBeNull();
});

test("the create row runs onCreate and resolves navigator.pick with nil", async ({
  sbPage,
}) => {
  const result = invokePickCommand(sbPage, "Navigator: Pick With Create");
  await waitForPlaceholder(sbPage, "Pick or create");
  const frame = navFrame(sbPage);

  await navInput(sbPage).fill("BrandNew");
  await expect(frame.locator(".sb-nav-create .sb-nav-primary")).toHaveText(
    "BrandNew",
  );
  await frame.locator(".sb-nav-create").click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();

  expect(await result).toBeNull();

  await runCommandViaPalette(sbPage, "Navigator: Pick Reflect");
  const reflect = navFrame(sbPage);
  await expect(
    reflect.locator(".sb-nav-row", { hasText: "created=BrandNew" }),
  ).toBeVisible();
  await sbPage.keyboard.press("Escape");
});

test("switching segments inside a pick writes nothing to the datastore", async ({
  sbPage,
}) => {
  const result = invokePickCommand(sbPage, "Navigator: Pick With Segments");
  await waitForPlaceholder(sbPage, "Pick");
  const frame = navFrame(sbPage);
  await expect(frame.locator(".sb-nav-row", { hasText: "One" })).toBeVisible();

  await sbPage.evaluate(() => {
    const f = document.querySelector(".sb-modal iframe") as HTMLIFrameElement;
    const w = f.contentWindow as any;
    const log: string[] = [];
    (globalThis as any).__pickSyscalls = log;
    const orig = w.syscall;
    w.syscall = (name: string, ...args: unknown[]) => {
      log.push(name);
      return orig(name, ...args);
    };
  });

  await navSegment(frame, "Odd").click();
  await expect(frame.locator(".sb-nav-row", { hasText: "Two" })).toHaveCount(0);
  await expect(frame.locator(".sb-nav-row", { hasText: "One" })).toBeVisible();

  const calls = await sbPage.evaluate(
    () => (globalThis as any).__pickSyscalls as string[],
  );
  expect(calls).not.toContain("datastore.set");

  await frame.locator(".sb-nav-row", { hasText: "One" }).click();
  await expect(sbPage.locator(".sb-modal")).toBeHidden();
  expect(await result).toBe("One");
});

test("navigator.pick rejects every navigator.define (name-world) field", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigator: Pick Reject Fields");
  const frame = navFrame(sbPage);
  await expect(
    frame.locator(".sb-nav-row", { hasText: "name=false" }).first(),
  ).toBeVisible({ timeout: 20_000 });
  const rows = await frame
    .locator(".sb-nav-row .sb-nav-primary")
    .allInnerTexts();
  const expectFalse = [
    "name",
    "command",
    "key",
    "mac",
    "menu",
    "menuMac",
    "menuWindows",
    "menuLinux",
    "hide",
    "dock",
    "openOnStart",
    "refreshOn",
    "refreshOnOpen",
    "followEditor",
    "onMove",
    "prefixViews",
  ];
  for (const field of expectFalse) {
    expect(rows).toContain(`${field}=false`);
  }
  const nameError = rows.find((r) => r.startsWith("name.error="));
  expect(nameError).toBeDefined();
  expect(nameError).toContain("navigator.define");
  expect(nameError).toContain("'name'");
  await sbPage.keyboard.press("Escape");
});

test("navigator.define and navigator.open both reject the reserved pick prefix", async ({
  sbPage,
}) => {
  await runCommandViaPalette(sbPage, "Navigator: Pick Prefix Validation");
  const frame = navFrame(sbPage);
  await expect(
    frame.locator(".sb-nav-row", { hasText: "reserved=" }).first(),
  ).toBeVisible({ timeout: 20_000 });
  const rows = await frame
    .locator(".sb-nav-row .sb-nav-primary")
    .allInnerTexts();
  expect(rows).toContain("reserved=false");
  expect(rows).toContain("normal=true");
  expect(rows).toContain("open=false");
  await sbPage.keyboard.press("Escape");
});
