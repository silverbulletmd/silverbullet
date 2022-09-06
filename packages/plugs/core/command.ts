import { queryPrefix } from "@silverbulletmd/plugos-silverbullet-syscall";
import { matchBefore } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { listCommands } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { applyQuery, QueryProviderEvent } from "../query/engine";

export async function commandComplete() {
  let prefix = await matchBefore("\\{\\[[^\\]]*");
  if (!prefix) {
    return null;
  }
  let allCommands = await listCommands();

  return {
    from: prefix.from + 2,
    options: Object.keys(allCommands).map((commandName) => ({
      label: commandName,
      type: "command",
    })),
  };
}
