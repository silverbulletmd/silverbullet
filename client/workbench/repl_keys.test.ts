import { expect, test } from "vitest";
import type { Command } from "../types/command.ts";
import { forwardsFromRepl, replCommandBindings } from "./repl_keys.ts";

test.each([
  ["Cmd-Alt-j", true],
  ["Ctrl-Alt-j", true],
  ["Cmd-/", true],
  ["Mod-k", true],
  ["Ctrl-k Ctrl-s", true],
  ["Enter", false],
  ["Shift-Enter", false],
  ["ArrowUp", false],
  ["Alt-ArrowUp", false],
  ["Mod-a", false],
  ["Cmd-z", false],
  ["Mod-Shift-z", false],
  ["Ctrl-c", false],
  ["Tab", false],
  ["Ctrl-Space", false],
  ["Escape", false],
  ["x", false],
  ["Shift-x", false],
])("forwardsFromRepl(%j) is %s", (key, expected) => {
  expect(forwardsFromRepl(key)).toBe(expected);
});

function cmd(def: Partial<Command>): Command {
  return { name: def.name ?? "Test: Command", ...def };
}

test("only binds global commands with app-level chords", () => {
  const ran: string[] = [];
  const commands = [
    cmd({ name: "Toggle", key: "Ctrl-Alt-j", mac: "Cmd-Alt-j" }),
    cmd({ name: "Palette", key: "Ctrl-/", mac: "Cmd-/" }),
    cmd({ name: "Anywhere", key: "Ctrl-Alt-y", requireEditor: "any" }),
    cmd({ name: "Newline", key: "Enter", requireEditor: "page" }),
    cmd({ name: "Bold", key: "Ctrl-b", requireEditor: "page" }),
    cmd({ name: "Doc only", key: "Ctrl-Alt-d", requireEditor: "notpage" }),
    cmd({ name: "In context", key: "Ctrl-Alt-c", contexts: ["FencedCode"] }),
    cmd({ name: "Writes", key: "Ctrl-Alt-w", requireMode: "rw" }),
    cmd({ name: "No key" }),
  ];
  const bindings = replCommandBindings(commands, {
    isMac: false,
    readOnly: true,
    run: (c) => ran.push(c.name),
  });
  expect(bindings.map((b) => b.key)).toEqual([
    "Ctrl-Alt-j",
    "Ctrl-/",
    "Ctrl-Alt-y",
  ]);
  for (const b of bindings) expect(b.run!({} as never)).toBe(true);
  expect(ran).toEqual(["Toggle", "Palette", "Anywhere"]);

  const mac = replCommandBindings(commands, {
    isMac: true,
    readOnly: false,
    run: () => {},
  });
  expect(mac.map((b) => b.key)).toEqual([
    "Cmd-Alt-j",
    "Cmd-/",
    "Ctrl-Alt-y",
    "Ctrl-Alt-w",
  ]);
});
