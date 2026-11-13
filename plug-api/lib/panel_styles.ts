import { getUiOption } from "../syscalls/editor.ts";

export type PanelStylesOptions = {
  /** Include the shared component stylesheet link (default true). */
  components?: boolean;
  /** Include the user's space-style CSS (default true). */
  spaceStyles?: boolean;
};

/**
 * Build an HTML preamble that styles a plug panel/widget iframe like the rest
 * of SilverBullet: the shared component stylesheet plus the user's space-style
 * CSS. Prepend the result to the HTML you pass to `editor.showPanel`.
 *
 * Order: components first (base), then space styles (so user theming wins),
 * leaving any plug-specific CSS you append afterwards highest-precedence.
 * The theme's part is a `<div id="sb-theme">` the panel, widget or document
 * editor iframe fills with the theme's CSS, and refills when the theme
 * changes, so keep it in the HTML you show.
 */
export async function panelStyles({
  components = true,
  spaceStyles = true,
}: PanelStylesOptions = {}): Promise<string> {
  let out = "";
  if (components) {
    out += `<link rel="stylesheet" href=".client/components.css">`;
  }
  if (spaceStyles) {
    const custom = await getUiOption("customStyles");
    if (typeof custom === "string" && custom) {
      out += custom;
    }
  }
  return out;
}
