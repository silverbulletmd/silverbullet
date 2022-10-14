import { editor, system } from "$sb/silverbullet-syscall/mod.ts";

export async function commandComplete() {
  const prefix = await editor.matchBefore("\\{\\[[^\\]]*");
  if (!prefix) {
    return null;
  }
  const allCommands = await system.listCommands();

  return {
    from: prefix.from + 2,
    options: Object.keys(allCommands).map((commandName) => ({
      label: commandName,
      type: "command",
    })),
  };
}
