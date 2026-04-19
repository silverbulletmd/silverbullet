import {
  config,
  editor,
  mq,
  space,
  sync,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { buildConfigurationHtml } from "./configuration_html.ts";
import { toLua } from "./lua_serialize.ts";
import {
  findManagedBlock,
  MANAGED_MARKER,
  replaceManagedBlock,
} from "./config_block.ts";

const CONFIG_PAGE = "CONFIG";

// Only handles the literals toLua() emits; complex values are not persisted
// through the UI and fall back to undefined.
function parseLuaLiteral(s: string): any {
  s = s.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "nil") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const strMatch = s.match(/^"([^"]*)"$/);
  if (strMatch) return strMatch[1];
  return undefined;
}

// Parses only the exact shape emitted by saveConfiguration() — the regex
// assumes strings without embedded quotes, braces, or parens.
function parseManagedBlock(blockContent: string): {
  configOverrides: Record<string, any>;
  commandOverrides: Record<string, { key?: string; mac?: string }>;
} {
  const configOverrides: Record<string, any> = {};
  const commandOverrides: Record<string, { key?: string; mac?: string }> = {};

  const configRe = /config\.set\("([^"]+)",\s*(.+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = configRe.exec(blockContent)) !== null) {
    configOverrides[m[1]] = parseLuaLiteral(m[2]);
  }

  const cmdRe = /command\.update\s*\{([^}]+)\}/g;
  while ((m = cmdRe.exec(blockContent)) !== null) {
    const body = m[1];
    const nameMatch = body.match(/name\s*=\s*"([^"]*)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const entry: { key?: string; mac?: string } = {};
    const keyMatch = body.match(/key\s*=\s*"([^"]*)"/);
    const macMatch = body.match(/mac\s*=\s*"([^"]*)"/);
    if (keyMatch) entry.key = keyMatch[1];
    if (macMatch) entry.mac = macMatch[1];
    commandOverrides[name] = entry;
  }

  return { configOverrides, commandOverrides };
}

export async function openConfiguration() {
  const [schemas, values, commands, configText] = await Promise.all([
    config.getSchemas(),
    config.getValues(),
    system.listCommands(),
    space.readPage(CONFIG_PAGE),
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

  const { html, script } = await buildConfigurationHtml(
    schemas,
    values,
    commands,
    commandOverrides,
    configOverrides,
    isMac,
  );
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

  const configText = await space.readPage(CONFIG_PAGE);

  const hasContent = Object.keys(pendingConfig).length > 0 ||
    Object.keys(pendingShortcuts).length > 0;

  const newText = replaceManagedBlock(
    configText,
    hasContent ? blockContent : "",
  );

  await space.writePage(CONFIG_PAGE, newText);

  await sync.performFileSync(CONFIG_PAGE + ".md");
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadUI();
}

