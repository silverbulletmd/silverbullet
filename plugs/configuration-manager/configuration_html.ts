import { asset } from "@silverbulletmd/silverbullet/syscalls";
import type { ConfigurationViewModel } from "./ui/types.ts";

const PLUG_NAME = "configuration-manager";

export type { ConfigurationViewModel };

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
  const script = `var __CFG = ${JSON.stringify(view)};\n${jsTemplate}`;

  return { html, script };
}
