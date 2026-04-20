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
import { parseManagedBlock, toLua } from "./lua.ts";
import {
  findManagedBlock,
  MANAGED_MARKER,
  replaceManagedBlock,
} from "./config_block.ts";

const CONFIG_PAGE = "CONFIG";
const PLUG_NAME = "configuration-manager";

// Seeded on first save when CONFIG doesn't yet exist. The managed fence is
// pre-placed so replaceManagedBlock updates it in-situ rather than appending.
async function readDefaultConfigTemplate(): Promise<string> {
  const template = await asset.readAsset(
    PLUG_NAME,
    "assets/config-template.md",
  );
  return template.replaceAll("{{MANAGED_MARKER}}", MANAGED_MARKER);
}

// space.readPage rejects with "Not found" when the page doesn't exist yet;
// treat that as an empty page rather than bubbling the error up to the user.
async function readConfigPage(): Promise<string> {
  try {
    return await space.readPage(CONFIG_PAGE);
  } catch {
    return "";
  }
}

export async function openConfiguration() {
  const [schemas, values, categories, commands, configText] = await Promise.all([
    config.getSchemas(),
    config.getValues(),
    config.getCategories(),
    system.listCommands(),
    readConfigPage(),
  ]);

  let configOverrides: Record<string, any> = {};
  let commandOverrides: Record<string, { key?: string; mac?: string }> = {};
  const block = findManagedBlock(configText);
  if (block) {
    const parsed = parseManagedBlock(block.innerContent);
    configOverrides = parsed.configOverrides;
    commandOverrides = parsed.commandOverrides;
  }

  const isMac = /Mac|iPhone|iPad/.test(
    globalThis.navigator?.userAgent || "",
  );

  const { html, script } = await buildConfigurationHtml({
    schemas,
    values,
    categories,
    commands,
    commandOverrides,
    configOverrides,
    isMac,
  });
  await editor.showPanel("modal", 100, html, script);
}

export async function saveConfiguration(
  pendingConfig: Record<string, any>,
  pendingShortcuts: Record<string, { key?: string; mac?: string }>,
) {
  const lines: string[] = [MANAGED_MARKER];

  for (const [path, value] of Object.entries(pendingConfig)) {
    if (value === undefined) continue;
    lines.push(`config.set(${toLua(path)}, ${toLua(value)})`);
  }

  for (const [name, override] of Object.entries(pendingShortcuts)) {
    const parts: string[] = [];
    parts.push(`name = ${toLua(name)}`);
    if (override.key !== undefined) parts.push(`key = ${toLua(override.key)}`);
    if (override.mac !== undefined) parts.push(`mac = ${toLua(override.mac)}`);
    lines.push(`command.update { ${parts.join(", ")} }`);
  }

  const blockContent = lines.join("\n");

  const configText = (await readConfigPage()) ||
    (await readDefaultConfigTemplate());

  const hasContent = Object.keys(pendingConfig).length > 0 ||
    Object.keys(pendingShortcuts).length > 0;

  const newText = replaceManagedBlock(
    configText,
    hasContent ? blockContent : "",
  );

  await space.writePage(CONFIG_PAGE, newText);

  await sync.performFileSync(`${CONFIG_PAGE}.md`);
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadUI();
}

