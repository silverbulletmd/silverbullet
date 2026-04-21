import { render } from "preact";
import { App } from "./App.tsx";
import { CfgContext } from "./CfgContext.tsx";
import { buildSchemaIndex } from "./schema.ts";
import type { ConfigurationViewModel } from "./types.ts";

// `configuration_html.ts` prepends `var __CFG = {...}` before this bundled
// script; the `var` hoists into the surrounding eval scope so the IIFE sees
// it via closure (a `const` would not).
declare const __CFG: ConfigurationViewModel;

const root = document.getElementById("cfg-root");
if (!root) throw new Error("cfg-root not found");

// Iframe needs focus to receive keydowns — otherwise Escape goes to the parent
// editor. tabindex=-1 lets us focus a non-interactive element programmatically.
root.setAttribute("tabindex", "-1");
(root as HTMLElement).focus();

const cfg = __CFG;
const schemaIndex = buildSchemaIndex(cfg);

render(
  <CfgContext.Provider value={{ cfg, schemaIndex }}>
    <App />
  </CfgContext.Provider>,
  root,
);
