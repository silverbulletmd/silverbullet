import { asset } from "@silverbulletmd/silverbullet/syscalls";

const PLUG_NAME = "configuration-manager";

/**
 * Builds the HTML body content and JS script for the configuration modal panel.
 * CSS and JS are loaded from plug assets; runtime data is injected into the JS.
 */
export type ConfigurationViewModel = {
  schemas: Record<string, any>;
  values: Record<string, any>;
  categories: Record<
    string,
    { name: string; description?: string; order?: number }
  >;
  commands: Record<string, any>;
  commandOverrides: Record<string, any>;
  configOverrides: Record<string, any>;
  isMac: boolean;
  initialTab: "configuration" | "shortcuts";
};

export async function buildConfigurationHtml(
  view: ConfigurationViewModel,
): Promise<{ html: string; script: string }> {
  const [css, jsTemplate] = await Promise.all([
    asset.readAsset(PLUG_NAME, "assets/configuration.css"),
    asset.readAsset(PLUG_NAME, "assets/configuration.js"),
  ]);

  const html = `<style>${css}</style><div id="cfg-root"></div>`;

  // `var` (not `const`) so the declaration hoists into the eval'd scope and
  // is lexically visible to the IIFE that the bundled script wraps us in.
  const script =
    `var __CFG = ${JSON.stringify(view)};\n${jsTemplate}`;

  return { html, script };
}
