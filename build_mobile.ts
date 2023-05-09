import { bundleClient, esbuild } from "./build_web.ts";
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
  await bundleClient(args.watch, "mobile", "mobile/dist");
  if (!args.watch) {
    esbuild.stop();
  }
}
