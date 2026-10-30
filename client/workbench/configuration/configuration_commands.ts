import { isMacLike } from "../../../plug-api/lib/shortcut.ts";
import type { Client } from "../../client.ts";
import {
  readConfigPage,
  saveManagedChanges,
} from "../../config_management/config_page.ts";
import { showView } from "../../navigator/navigator.ts";
import { setNativeBadge } from "../../navigator/ui/native_views.ts";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import type { CommandHook } from "../../plugos/hooks/command.ts";
import { ConfigurationModel, type Section } from "./configuration_model.ts";
import type { Commands } from "./keys.ts";

/** The Configuration tab's model, reading from and saving to this client. */
export function configurationModel(client: Client): ConfigurationModel {
  return new ConfigurationModel({
    load: async () => {
      const commands: Commands = {};
      const all = client.clientSystem.commandHook.buildAllCommands();
      for (const [name, { key, mac, hide }] of all) {
        commands[name] = { name, key, mac, hide };
      }
      return {
        schemas: client.config.schemas,
        values: client.config.values,
        categories: client.config.categories,
        commands,
        configText: await readConfigPage(),
        isMac: isMacLike,
        writable: !client.bootConfig.readOnly,
      };
    },
    save: saveManagedChanges,
    subscribeReload: (changed) =>
      client.clientSystem.spaceLuaEnv.onLoad(changed),
    onDirty: (dirty) =>
      setNativeBadge(WORKBENCH_VIEW, "Configuration", dirty ? "•" : undefined),
  });
}

export function registerConfigurationCommands(
  hook: CommandHook,
  model: ConfigurationModel,
): void {
  const open = (section: Section) => async () => {
    model.showSection(section);
    await showView(WORKBENCH_VIEW, { segment: "Configuration" });
    return false;
  };
  hook.registerCommand({
    name: "Configuration: Open",
    key: "Ctrl-,",
    mac: "Cmd-,",
    requireMode: "rw",
    menuMac: {
      location: "app",
      group: "4_prefs",
      order: 1,
      label: "Configuration...",
    },
    menu: {
      location: "file",
      group: "2_prefs",
      order: 1,
      label: "Configuration...",
    },
    run: open("configuration"),
  });
  hook.registerCommand({
    name: "Configuration: Keyboard Shortcuts",
    requireMode: "rw",
    menuMac: {
      location: "app",
      group: "4_prefs",
      order: 2,
      label: "Keyboard Shortcuts...",
    },
    menu: {
      location: "file",
      group: "2_prefs",
      order: 2,
      label: "Keyboard Shortcuts...",
    },
    run: open("keyBindings"),
  });
}
