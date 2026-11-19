import { join } from "node:path";
import { buildIconData } from "../../../build/build_icons.ts";
import { configureIcons } from "./registry.ts";

const { data: full } = await buildIconData(
  join(import.meta.dirname, "../../../node_modules/lucide-static"),
);

/** Test helper: configures the full Lucide set, as the client has it once loaded. */
export function useFullIcons(): void {
  configureIcons({ data: full });
}
