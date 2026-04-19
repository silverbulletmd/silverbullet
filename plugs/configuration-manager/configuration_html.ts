import { asset } from "@silverbulletmd/silverbullet/syscalls";

const PLUG_NAME = "configuration-manager";

/**
 * Builds the HTML body content and JS script for the configuration modal panel.
 * CSS and JS are loaded from plug assets; runtime data is injected into the JS.
 */
export async function buildConfigurationHtml(
  schemas: Record<string, any>,
  values: Record<string, any>,
  commands: Record<string, any>,
  commandOverrides: Record<string, any>,
  configOverrides: Record<string, any>,
  isMac: boolean,
): Promise<{ html: string; script: string }> {
  const [css, jsTemplate] = await Promise.all([
    asset.readAsset(PLUG_NAME, "assets/configuration.css"),
    asset.readAsset(PLUG_NAME, "assets/configuration.js"),
  ]);

  const html = `<style>${css}</style>
<div id="cfg-root">
  <div id="cfg-header">
    <h1>Configuration</h1>
    <button id="cfg-close" title="Close">&times;</button>
    <div id="cfg-tabs"></div>
  </div>
  <div id="cfg-content"></div>
  <div id="cfg-footer">
    <button class="cfg-btn" id="cfg-cancel">Cancel</button>
    <button class="cfg-btn cfg-btn-primary" id="cfg-save">Save &amp; Apply</button>
  </div>
</div>`;

  // Inject runtime data by replacing the placeholder values in the JS template.
  // Using function replacers to avoid special $-character handling in replacement strings.
  const script = jsTemplate
    .replace("/*INJECT:SCHEMAS*/null", () => JSON.stringify(schemas))
    .replace("/*INJECT:VALUES*/null", () => JSON.stringify(values))
    .replace("/*INJECT:COMMANDS*/null", () => JSON.stringify(commands))
    .replace("/*INJECT:COMMAND_OVERRIDES*/null", () => JSON.stringify(commandOverrides))
    .replace("/*INJECT:CONFIG_OVERRIDES*/null", () => JSON.stringify(configOverrides))
    .replace("/*INJECT:IS_MAC*/false", () => String(isMac));

  return { html, script };
}
