import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { baseMeta, type BuiltinView } from "./types.ts";

/** A row here is a registered command, not an indexed object -- no
 * `ref`/`tag` of its own -- exactly `system.listPaletteCommands()`'s own
 * return shape. */
type CommandRow = {
  name: string;
  priority: number;
  lastRun?: number;
  hint?: string;
};

export const commandPalette: BuiltinView<CommandRow> = {
  meta: baseMeta({
    title: "Commands",
    label: "Run",
    placeholder: "Command",
    filterFields: { primary: { weight: 1.0, segments: true } },
    // Which commands apply (the cursor's context, the client's mode) and
    // which you ran last are both only true at the moment you ask.
    refreshOnOpen: true,
    // Not the file events every other view wants: the command list changes
    // when plugs (re)load, and nothing else.
    refreshOn: ["plugs:loaded"],
  }),
  row: {
    decorations: (obj) =>
      obj.hint
        ? [
            {
              text: obj.hint,
              position: "right",
              cssClass: "sb-nav-chip-hint sb-nav-chip-key",
            },
          ]
        : undefined,
    icon: () => "terminal",
  },
  source: async () => {
    const commands = await system.listPaletteCommands();
    return [...commands].sort((a, b) => {
      // Anything you have run on this client outranks anything merely
      // declared important.
      if (a.lastRun !== undefined && b.lastRun !== undefined) {
        return b.lastRun - a.lastRun;
      }
      if (a.lastRun !== undefined || b.lastRun !== undefined) {
        return a.lastRun !== undefined ? -1 : 1;
      }
      return b.priority - a.priority || a.name.localeCompare(b.name);
    });
  },
  onSelect: async (obj) => {
    // The palette has to be out of the way *before* the command runs: a
    // command that opens another navigator view would otherwise have its
    // panel closed again by this one's own dismissal.
    await editor.hidePanel("modal");
    // Records the run (which is what orders the palette) and then runs it. A
    // command returning false is one that took the focus deliberately.
    if ((await system.runPaletteCommand(obj.name)) !== false) {
      await editor.focus();
    }
    return false;
  },
};
