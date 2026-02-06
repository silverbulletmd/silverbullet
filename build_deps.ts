// deno-lint-ignore-file no-import-prefix

// To avoid having to create import maps for plug-compile, we're centralizing the build dependencies here instead of putting them in deno.json

import * as esbuild from "npm:esbuild@^0.27.3";
import { denoPlugin } from "jsr:@deno/esbuild-plugin@^1.2.1";

export { esbuild };
export { denoPlugin };
