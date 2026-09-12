import { readFile } from "node:fs/promises";
import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";

export const origin = "http://spaces.test";
export { expect };
export const test = base.extend<{}, { spacesJavascript: string }>({
  spacesJavascript: [
    async ({ playwright: _playwright }, use) => {
      const result = await build({
        entryPoints: ["client/spaces_ui/spaces.tsx"],
        bundle: true,
        write: false,
        format: "esm",
        jsx: "automatic",
        jsxImportSource: "preact",
      });
      await use(result.outputFiles[0].text);
    },
    { scope: "worker" },
  ],
  page: async ({ page, spacesJavascript }, use) => {
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/assets/spaces.js"))
        return route.fulfill({
          contentType: "text/javascript",
          body: spacesJavascript,
        });
      if (path.endsWith("/assets/app.css"))
        return route.fulfill({
          path: "client_bundle/client/.client/app.css",
          contentType: "text/css",
        });
      if (path.includes("/assets/")) return route.fulfill({ status: 204 });
      if (path.endsWith("/api/session") || path.endsWith("/api/profile"))
        return route.fulfill({
          json: { username: "fixture-admin", admin: true, fullName: null },
        });
      if (path.endsWith("/api/admin/users")) return route.fulfill({ json: {} });
      if (path.endsWith("/api/spaces") || path.endsWith("/api/admin/spaces"))
        return route.fulfill({ json: [] });
      if (path.endsWith("/api/admin/server-info"))
        return route.fulfill({
          json: { runtimeApi: { available: false }, runtimeApiEnabled: false },
        });
      if (path.endsWith("/api/admin/fs/dirs"))
        return route.fulfill({
          json: { status: "exists", writable: true, suggestions: [] },
        });
      if (path.includes("/api/"))
        throw new Error(
          `Unmocked manager API: ${route.request().method()} ${path}`,
        );
      if (route.request().isNavigationRequest())
        return route.fulfill({
          contentType: "text/html",
          body: await readFile("client/html/spaces.html", "utf8"),
        });
      return route.fulfill({ status: 404 });
    });
    await use(page);
  },
});
