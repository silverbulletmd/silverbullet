import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // @silverbulletmd/silverbullet/* → local plug-api/ files
      {
        find: /^@silverbulletmd\/silverbullet\/lib\/(.*)$/,
        replacement: path.resolve(__dirname, "plug-api/lib/$1.ts"),
      },
      {
        find: /^@silverbulletmd\/silverbullet\/type\/(.*)$/,
        replacement: path.resolve(__dirname, "plug-api/types/$1.ts"),
      },
      {
        find: "@silverbulletmd/silverbullet/syscall",
        replacement: path.resolve(__dirname, "plug-api/syscall.ts"),
      },
      {
        find: "@silverbulletmd/silverbullet/syscalls",
        replacement: path.resolve(__dirname, "plug-api/syscalls.ts"),
      },
      {
        find: "@silverbulletmd/silverbullet/constants",
        replacement: path.resolve(__dirname, "plug-api/constants.ts"),
      },
      // fuse → fuse.js
      {
        find: "fuse",
        replacement: "fuse.js",
      },
    ],
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.opencode/**",
      "dist",
      "client_bundle",
      "website",
      "server",
      // Exclude helper test files (no test() blocks, only export helper functions)
      "client/data/kv_primitives.test.ts",
      "client/spaces/space_primitives.test.ts",
    ],
  },
});
