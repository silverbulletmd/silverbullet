import { bundle, esbuild } from "./build_web.ts";
import * as flags from "https://deno.land/std@0.165.0/flags/mod.ts";
import { copy } from "https://deno.land/std@0.165.0/fs/copy.ts";

if (import.meta.main) {
  const args = flags.parse(Deno.args, {
    boolean: ["watch"],
    alias: { w: "watch" },
    default: {
      watch: false,
    },
  });
  await bundle(args.watch, "mobile", "mobile/dist");
  await copy("mobile/index.html", `mobile/dist/index.html`, {
    overwrite: true,
  });
  if (!args.watch) {
    esbuild.stop();
  }
}
