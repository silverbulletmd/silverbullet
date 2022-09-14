import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import commonjs from "@rollup/plugin-commonjs";
import { string } from "rollup-plugin-string";
import replace from "@rollup/plugin-replace";
import webWorkerLoader from "rollup-plugin-web-worker-loader";
import scss from "rollup-plugin-scss";
import { defineConfig } from "rollup";
// import { terser } from "rollup-plugin-terser";
import copy from "rollup-plugin-copy";

const stringPlugin = string;

export default defineConfig([
  {
    input: "packages/web/boot.ts",
    output: {
      file: "packages/web/dist/bundle.js",
      format: "iife",
      sourcemap: true,
    },
    plugins: [
      typescript(),
      nodeResolve(),
      json(),
      commonjs(),
      stringPlugin({
        include: "**/*.html",
      }),
      replace({
        "process.env.NODE_ENV": JSON.stringify("production"),
        preventAssignment: true,
      }),
      webWorkerLoader({}),
      scss({
        output: "packages/web/dist/bundle.css",
      }),
      copy({
        targets: [
          {
            src: "packages/web/index.html",
            dest: "packages/web/dist",
          },
          {
            src: "packages/web/fonts/*",
            dest: "packages/web/dist",
          },
        ],
      }),
    ],
  },
  {
    input: "packages/server/server.ts",
    output: {
      file: "packages/server/dist/server.js",
      format: "cjs",
      sourcemap: true,
    },
    // external: [/node_modules\/(/],
    plugins: [
      typescript(),
      nodeResolve({
        preferBuiltins: true,
      }),
      stringPlugin({
        include: [
          "packages/server/SETTINGS_template.md",
          "packages/plugos/environments/node_worker.ts",
        ],
      }),
      json(),
      commonjs({}),
    ],
  },
]);
