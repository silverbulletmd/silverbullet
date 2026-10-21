import {
  asset,
  config,
  editor,
  mq,
  space,
  sync,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { buildConfigurationHtml } from "./configuration_html.ts";
import { type CommandOverride, parseManagedBlock } from "./lua.ts";
import {
  findManagedBlock,
  invalidManagedBlockMessage,
  MANAGED_MARKER,
} from "./config_block.ts";
import { applyManagedChanges } from "./managed_edit.ts";
import type { ManagedChanges } from "./overrides.ts";
import type { TabId } from "./ui/types.ts";

const CONFIG_PAGE = "CONFIG";
const PLUG_NAME = "configuration-manager";

async function readDefaultConfigTemplate(): Promise<string> {
  const template = await asset.readAsset(PLUG_NAME, "assets/CONFIG.md");
  return template.replaceAll("{{MANAGED_MARKER}}", MANAGED_MARKER);
}

async function readConfigPage(): Promise<string> {
  try {
    return await space.readPage(CONFIG_PAGE);
  } catch {
    return "";
  }
}

export async function openConfiguration() {
  await openPanel("configuration");
}

export async function openShortcuts() {
  await openPanel("shortcuts");
}

async function openPanel(initialTab: TabId) {
  const [schemas, values, categories, commands, configText] = await Promise.all(
    [
      config.getSchemas(),
      config.getValues(),
      config.getCategories(),
      system.listCommands(),
      readConfigPage(),
    ],
  );

  let configOverrides: Record<string, any> = {};
  let commandOverrides: Record<string, CommandOverride> = {};
  let managedBlockError: string | undefined;
  const block = findManagedBlock(configText);
  if (block) {
    const parsed = await parseManagedBlock(block.innerContent);
    configOverrides = parsed.configOverrides;
    commandOverrides = parsed.commandOverrides;
    if (parsed.error !== undefined) {
      managedBlockError = invalidManagedBlockMessage(parsed.error);
    }
  }

  const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent || "");

  const { html, script } = await buildConfigurationHtml({
    schemas,
    values,
    categories,
    commands,
    commandOverrides,
    configOverrides,
    managedBlockError,
    isMac,
    initialTab,
  });
  await editor.showPanel("modal", 100, html, script);
}

/** Apply changes to the managed block of CONFIG and reload. */
async function updateConfigPage(changes: ManagedChanges) {
  const configText =
    (await readConfigPage()) || (await readDefaultConfigTemplate());
  await space.writePage(
    CONFIG_PAGE,
    await applyManagedChanges(configText, changes),
  );
  await sync.performFileSync(`${CONFIG_PAGE}.md`);
  await mq.send("indexQueue", `${CONFIG_PAGE}.md`);
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadConfigAndCommands();
}

/**
 * Saves the configuration panel: only the overrides changed in it, so
 * values written meanwhile (e.g. by Share) are kept.
 */
export async function saveConfiguration(changes: ManagedChanges) {
  await updateConfigPage(changes);
  await editor.rebuildEditorState();
}

/**
 * Write or replace exactly one `config.set(path, value)` line in the managed
 * block of CONFIG, leaving everything else untouched.
 */
export async function setConfigValue(path: string, value: unknown) {
  await updateConfigPage({ config: { set: { [path]: value }, unset: [] } });
}
