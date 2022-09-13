import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import commonjs from "@rollup/plugin-commonjs";
import { string } from "rollup-plugin-string";
import replace from "@rollup/plugin-replace";
import webWorkerLoader from "rollup-plugin-web-worker-loader";
import scss from "rollup-plugin-scss";
import { defineConfig } from "rollup";
import { terser } from "rollup-plugin-terser";

export default defineConfig({
  input: {
    web: "packages/web/boot.ts",
  },

  output: [
    {
      dir: ".",
      entryFileNames: "packages/[name]/rdist/bundle.js",
      format: "umd",
      sourcemap: true,
    },
    {
      dir: ".",
      entryFileNames: "packages/[name]/rdist/bundle.min.js",
      format: "umd",
      plugins: [terser()],
    },
  ],

  treeshake: "recommended",
  plugins: [
    typescript(),
    nodeResolve(),
    json(),
    commonjs(),
    string({
      include: "**/*.html",
    }),
    replace({
      "process.env.NODE_ENV": JSON.stringify("production"),
      preventAssignment: true,
    }),
    webWorkerLoader({}),
    scss({
      output: "packages/web/rdist/bundle.css",
    }),
  ],
});
