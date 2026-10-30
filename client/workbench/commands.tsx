import type { Client } from "../client.ts";
import { showView, toggleView } from "../navigator/navigator.ts";
import { registerNativeView } from "../navigator/ui/native_views.ts";
import {
  EDIT_QUERY_COMMAND,
  WORKBENCH_TABS,
  WORKBENCH_VIEW,
} from "../navigator/views/workbench.ts";
import type { CommandHook } from "../plugos/hooks/command.ts";
import { lintPages } from "../space_lint.ts";
import { spaceLintDeps } from "../space_lint_deps.ts";
import { LuaEnv } from "../space_lua/runtime.ts";
import type { SlashCommand } from "../types/command.ts";
import {
  configurationModel,
  registerConfigurationCommands,
} from "./configuration/configuration_commands.ts";
import { consoleLog } from "./console/console_log.ts";
import { ConsoleSession } from "./console/console_session.ts";
import { DeepCheck } from "./health/deep_check.ts";
import { HealthMonitor, healthWatch } from "./health/health_sources.ts";
import { updateByName } from "./libraries/libraries_backend.ts";
import {
  LIBRARY_COMMANDS,
  runLibraryCommand,
  runLibraryUpdate,
} from "./libraries/libraries_commands.ts";
import { QueryBuilder } from "./query/query_builder.ts";
import {
  openQuery,
  type QuerySpan,
  showQueryEditor,
} from "./query/query_open.ts";
import { WorkbenchView } from "./workbench.tsx";

export function registerWorkbenchCommands(
  client: Client,
  hook: CommandHook,
): { builder: QueryBuilder } {
  // Called while the client is still being set up, so its parts are read when used
  const session = new ConsoleSession({
    spaceEnv: () => client.clientSystem.spaceLuaEnv.env,
    currentPage: () => client.currentName(),
    pageContext: async (page) => {
      const scope = await client.clientSystem.pageScopes.get(page);
      if (scope?.firstError) throw new Error(scope.firstError);
      return {
        env:
          scope?.env ??
          new LuaEnv(client.clientSystem.spaceLuaEnv.env, { boundary: true }),
        meta: {
          ...(await client.objectIndex.getObjectByRef(page, "page", page)),
          name: page,
        },
      };
    },
    log: consoleLog,
    ui: () => client.ui,
  });
  const builder = new QueryBuilder();
  const health = new HealthMonitor(
    healthWatch(client),
    new DeepCheck((opts) => lintPages(spaceLintDeps(client), undefined, opts)),
  );
  const configuration = configurationModel(client);
  registerNativeView(WORKBENCH_VIEW, (props) => (
    <WorkbenchView
      {...props}
      session={session}
      builder={builder}
      health={health}
      configuration={configuration}
    />
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
  registerConfigurationCommands(hook, configuration);
  for (const { name, focus, requireMode, menu, menuMac } of LIBRARY_COMMANDS) {
    hook.registerCommand({
      name,
      requireMode,
      menu,
      menuMac,
      run: () => runLibraryCommand(focus, showView),
    });
  }
  // Called by the Shared Pages view; opens nothing
  hook.registerCommand({
    name: "Library: Update",
    hide: true,
    requireMode: "rw",
    run: async (args?: unknown[]) => {
      await runLibraryUpdate(args, updateByName, (message, type) =>
        client.ui.flashNotification(message, type),
      );
      return false;
    },
  });
  // The ⋯ menu of a query widget passes the query; the palette leaves it to the cursor
  hook.registerCommand({
    name: EDIT_QUERY_COMMAND,
    run: async (args?: unknown[]) => {
      await openQuery(client, builder, args?.[0] as QuerySpan | undefined);
      return false;
    },
  });
  return { builder };
}

/**
 * `/Query…`: opens the Workbench on the Query tab with the query editor
 * showing, bound to where it was typed. The hook has already removed the
 * typed text when this runs.
 */
export function querySlashCommand(
  client: Client,
  builder: QueryBuilder,
): SlashCommand {
  return {
    name: "Query…",
    description: "Build a query in the Workbench and insert it here",
    run: async () => {
      const head = client.editorView.state.selection.main.head;
      await showQueryEditor(client, builder, {
        page: client.currentName(),
        from: head,
        to: head,
      });
      return { options: [] };
    },
  };
}
