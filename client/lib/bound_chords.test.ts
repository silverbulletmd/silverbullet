import { expect, test } from "vitest";
import { boundChordManifest, parseChord } from "./bound_chords.ts";
import type { Client } from "../client.ts";
import type { Command } from "../types/command.ts";

function fakeClient(opts: {
  commands: Command[];
  vimMode?: boolean;
  readOnly?: boolean;
  currentEditor?: string;
}): Client {
  const commandMap = new Map(opts.commands.map((c) => [c.name, c]));
  return {
    ui: { viewState: { uiOptions: { vimMode: opts.vimMode ?? false } } },
    isReadOnlyMode: () => opts.readOnly ?? false,
    contentManager: {
      documentEditor: opts.currentEditor
        ? { name: opts.currentEditor }
        : undefined,
    },
    clientSystem: { commandHook: { buildAllCommands: () => commandMap } },
  } as unknown as Client;
}

function cmd(name: string, extra: Partial<Command> = {}): Command {
  return { name, run: async () => {}, ...extra } as Command;
}

test("parseChord: rejects multi-step, non-Ctrl/Cmd, and unrecognized modifiers", () => {
  expect(parseChord("Mod-. t")).toBeUndefined();
  expect(parseChord("Alt-x")).toBeUndefined();
  expect(parseChord("Bogus-o")).toBeUndefined();
  expect(parseChord("Ctrl-o")).toEqual({
    key: "o",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  });
});

test("boundChordManifest: a write-mode-only chord is excluded while the page is read-only", () => {
  const commands = [cmd("Text: Bold", { key: "Ctrl-b", requireMode: "rw" })];

  const rw = boundChordManifest(fakeClient({ commands, readOnly: false }));
  expect(rw).toContainEqual(
    expect.objectContaining({ key: "b", ctrlKey: true }),
  );

  const ro = boundChordManifest(fakeClient({ commands, readOnly: true }));
  expect(ro).not.toContainEqual(
    expect.objectContaining({ key: "b", ctrlKey: true }),
  );
});

test("boundChordManifest: a vim-disabled chord is excluded while vim mode is on", () => {
  const commands = [
    cmd("Some: Command", { key: "Ctrl-e", disableInVim: true }),
  ];

  expect(
    boundChordManifest(fakeClient({ commands, vimMode: false })),
  ).toContainEqual(expect.objectContaining({ key: "e", ctrlKey: true }));
  expect(
    boundChordManifest(fakeClient({ commands, vimMode: true })),
  ).not.toContainEqual(expect.objectContaining({ key: "e", ctrlKey: true }));
});

test("boundChordManifest: a chord requiring a different editor context is excluded", () => {
  const commands = [
    cmd("Doc: Rotate", { key: "Ctrl-r", requireEditor: "image" }),
  ];

  expect(
    boundChordManifest(fakeClient({ commands, currentEditor: "image" })),
  ).toContainEqual(expect.objectContaining({ key: "r", ctrlKey: true }));
  expect(
    boundChordManifest(fakeClient({ commands, currentEditor: undefined })),
  ).not.toContainEqual(expect.objectContaining({ key: "r", ctrlKey: true }));
});

test("boundChordManifest: a multi-step binding contributes only its first token", () => {
  const commands = [cmd("Task: Cycle State", { key: "Mod-. t" })];

  const chords = boundChordManifest(fakeClient({ commands }));
  expect(chords).toContainEqual(expect.objectContaining({ key: "." }));
  expect(chords).not.toContainEqual(expect.objectContaining({ key: "t" }));
});
