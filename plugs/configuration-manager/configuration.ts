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
import { type CommandOverride, parseManagedBlock, toLua } from "./lua.ts";
import {
  findManagedBlock,
  MANAGED_MARKER,
  replaceManagedBlock,
} from "./config_block.ts";
import { listLibraries } from "./libraries.ts";
import type { LibrariesFocus, TabId } from "./ui/types.ts";

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

export async function openLibraries() {
  await openPanel("libraries");
}

// Legacy slash-command aliases — each opens the Libraries tab with a specific
// focus hint so the UI can auto-trigger the matching action/form.
export async function openLibrariesLegacyManager() {
  await openPanel("libraries", "manager");
}
export async function openLibrariesInstall() {
  await openPanel("libraries", "install");
}
export async function openLibrariesAddRepo() {
  await openPanel("libraries", "addRepository");
}
export async function openLibrariesUpdateAll() {
  await openPanel("libraries", "updateAll");
}
export async function openLibrariesUpdateAllRepos() {
  await openPanel("libraries", "updateAllRepositories");
}

async function openPanel(initialTab: TabId, librariesFocus?: LibrariesFocus) {
  const [schemas, values, categories, commands, configText, libraries] =
    await Promise.all([
      config.getSchemas(),
      config.getValues(),
      config.getCategories(),
      system.listCommands(),
      readConfigPage(),
      listLibraries(),
    ]);

  let configOverrides: Record<string, any> = {};
  let commandOverrides: Record<string, CommandOverride> = {};
  const block = findManagedBlock(configText);
  if (block) {
    const parsed = parseManagedBlock(block.innerContent);
    configOverrides = parsed.configOverrides;
    commandOverrides = parsed.commandOverrides;
  }

  const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent || "");

  const { html, script } = await buildConfigurationHtml({
    schemas,
    values,
    categories,
    commands,
    commandOverrides,
    configOverrides,
    isMac,
    initialTab,
    libraries,
    librariesFocus,
  });
  await editor.showPanel("modal", 100, html, script);
}

export async function saveConfiguration(
  pendingConfig: Record<string, any>,
  pendingShortcuts: Record<string, CommandOverride>,
) {
  const lines: string[] = [MANAGED_MARKER];

  for (const [path, value] of Object.entries(pendingConfig)) {
    if (value === undefined) continue;
    lines.push(`config.set(${toLua(path)}, ${toLua(value)})`);
  }

  for (const [name, override] of Object.entries(pendingShortcuts)) {
    const parts: string[] = [];
    parts.push(`name = ${toLua(name)}`);
    if (override.key !== undefined) {
      parts.push(`key = ${toLua(override.key)}`);
    }
    if (override.mac !== undefined) {
      parts.push(`mac = ${toLua(override.mac)}`);
    }
    lines.push(`command.update { ${parts.join(", ")} }`);
  }

  const blockContent = lines.join("\n");

  const configText =
    (await readConfigPage()) || (await readDefaultConfigTemplate());

  const hasContent =
    Object.keys(pendingConfig).length > 0 ||
    Object.keys(pendingShortcuts).length > 0;

  const newText = replaceManagedBlock(
    configText,
    hasContent ? blockContent : "",
  );

  await space.writePage(CONFIG_PAGE, newText);

  await sync.performFileSync(`${CONFIG_PAGE}.md`);
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadConfigAndCommands();
  await editor.rebuildEditorState();
}
