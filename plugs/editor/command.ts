import { system } from "$sb/syscalls.ts";
import { CompleteEvent } from "../../plug-api/types.ts";

export async function commandComplete(completeEvent: CompleteEvent) {
  const match = /\{\[([^\]\[]*)$/.exec(completeEvent.linePrefix);

  if (!match) {
    return null;
  }
  const allCommands = await system.listCommands();

  return {
    from: completeEvent.pos - match[1].length,
    options: Object.keys(allCommands).map((commandName) => ({
      label: commandName,
      type: "command",
    })),
  };
}
