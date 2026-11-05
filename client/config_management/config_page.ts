import { editor, mq, space, sync } from "@silverbulletmd/silverbullet/syscalls";
import { notFoundError } from "../../plug-api/constants.ts";
import { MANAGED_MARKER } from "./config_block.ts";
import { applyManagedChanges, type ManagedChanges } from "./managed_edit.ts";
import { reloadConfig } from "./reload.ts";
import { applySchemaChanges, type SchemaChanges } from "./schema_block.ts";

export const CONFIG_PAGE = "CONFIG";

const CONFIG_TEMPLATE = `#meta

This page holds configuration for your SilverBullet space. See [[^Library/Std/Config]] for all options and defaults.

Run \${widgets.commandButton "System: Reload"} to reload.

## User configuration
Anything you add to the block below is yours, edit freely.

\`\`\`space-lua
-- Add custom configuration here, e.g.:
-- config.set("shortWikiLinks", false)
\`\`\`

## Managed by the Workbench
The block below is maintained by the \${widgets.commandButton("Configuration", "Configuration: Open")} tab of the Workbench. Prefer editing it there, although simple hand edits should survive.

\`\`\`space-lua
${MANAGED_MARKER}
\`\`\``;

/**
 * The text of CONFIG, or "" when there is none yet. Any other read error is
 * thrown: treating it as missing would let a save replace CONFIG.
 */
export async function readConfigPage(): Promise<string> {
  try {
    return await space.readPage(CONFIG_PAGE);
  } catch (e: any) {
    if (e?.message === notFoundError.message) return "";
    throw e;
  }
}

/**
 * Applies changes to the managed block of CONFIG (creating the page from a
 * template if needed) and reloads configuration. Throws, writing nothing,
 * when the managed block is not valid Lua.
 */
export function saveManagedChanges(changes: ManagedChanges): Promise<void> {
  return writeConfigAndReload((text) => applyManagedChanges(text, changes));
}

/** Thrown when CONFIG was written but reloading it failed */
export class ConfigReloadError extends Error {}

/**
 * Applies changes to the managed schemas block of CONFIG and reloads. Throws,
 * writing nothing, when that block is not valid Lua; an error thrown after
 * the write is a ConfigReloadError.
 */
export function saveSchemaChanges(changes: SchemaChanges): Promise<void> {
  return writeConfigAndReload((text) => applySchemaChanges(text, changes));
}

/**
 * Edits CONFIG (created from the template if needed), writes it and reloads
 * configuration. An open CONFIG with unsaved edits is saved first, so the
 * edit applies to them rather than overwriting them.
 */
export async function writeConfigAndReload(
  edit: (text: string) => string,
): Promise<void> {
  const configOpen = (await editor.getCurrentPage()) === CONFIG_PAGE;
  if (configOpen) await editor.save();
  const text = (await readConfigPage()) || CONFIG_TEMPLATE;
  await space.writePage(CONFIG_PAGE, edit(text));
  // The editor doesn't follow a write it didn't make: show the new text
  if (configOpen) await editor.reloadPage();
  try {
    // Index CONFIG before reloading, so the reload runs the block just written
    await sync.performFileSync(`${CONFIG_PAGE}.md`);
    await mq.send("indexQueue", `${CONFIG_PAGE}.md`);
    await reloadConfig();
    await editor.rebuildEditorState();
  } catch (e: any) {
    throw new ConfigReloadError(
      `Saved to CONFIG, but reloading failed: ${e?.message ?? e}`,
    );
  }
}

/** Writes or replaces exactly one `config.set(path, value)` line in CONFIG. */
export function persistConfigValue(
  path: string,
  value: unknown,
): Promise<void> {
  return saveManagedChanges({ config: { set: { [path]: value }, unset: [] } });
}
