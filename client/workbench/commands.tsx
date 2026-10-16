import type { Client } from "../client.ts";
import { showView, toggleView } from "../navigator/navigator.ts";
import { registerNativeView } from "../navigator/ui/native_views.ts";
import {
  WORKBENCH_TABS,
  WORKBENCH_VIEW,
} from "../navigator/views/workbench.ts";
import type { CommandHook } from "../plugos/hooks/command.ts";
import { consoleLog } from "./console_log.ts";
import { ConsoleSession } from "./console_session.ts";
import { WorkbenchView } from "./ui/workbench.tsx";

export function registerWorkbenchCommands(
  client: Client,
  hook: CommandHook,
): void {
  // Called while the client is still being set up, so its parts are read when used
  const session = new ConsoleSession({
    spaceEnv: () => client.clientSystem.spaceLuaEnv.env,
    log: consoleLog,
    ui: () => client.ui,
  });
  registerNativeView(WORKBENCH_VIEW, (props) => (
    <WorkbenchView {...props} session={session} />
  ));
  hook.registerCommand({
    name: "Workbench: Toggle",
    key: "Ctrl-Alt-j",
    mac: "Cmd-Alt-j",
    run: async () => {
      if ((await toggleView(WORKBENCH_VIEW)) === "closed") {
        client.focus();
        return;
      }
      // The panel took focus; `false` stops the palette handing it back to the editor
      return false;
    },
  });
  // One per tab: opens the Workbench on it, or switches an open one to it,
  // never closing it (that is what Toggle is for)
  for (const tab of WORKBENCH_TABS) {
    hook.registerCommand({
      name: `Workbench: ${tab}`,
      run: async () => {
        await showView(WORKBENCH_VIEW, { segment: tab });
        return false;
      },
    });
  }
}
