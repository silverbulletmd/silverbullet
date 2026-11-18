import { expect, origin, test } from "../fixtures.ts";

test("APIs saves runtime and MCP settings together in one form", async ({
  page,
}) => {
  let config = {
    primaryUrl: null,
    serverName: "SilverBullet",
    runtimeApi: true,
    runtimeIdleTimeout: 30,
    mcp: false,
  };
  const saves: unknown[] = [];
  await page.route("**/.dashboard/api/admin/server-config", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saves.push(body);
      config = { ...config, ...body };
    }
    return route.fulfill({ json: config });
  });
  await page.route("**/.dashboard/api/admin/server-info", (route) =>
    route.fulfill({
      json: {
        runtimeApi: { status: "available" },
        runtimeApiEnabled: true,
        mcp: { status: "available" },
        mcpEnabled: false,
      },
    }),
  );
  await page.goto(`${origin}/.dashboard/settings?section=apis`);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(1);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Endpoint URL")).toHaveCount(0);

  await page.getByLabel("Enable MCP").check();
  await page.getByLabel("Enable runtime API").uncheck();
  await expect(
    page.getByText(/so the lua and screenshot tools are unavailable/),
  ).toBeVisible();
  await page.getByLabel("Enable runtime API").check();
  await expect(
    page.getByText(/so the lua and screenshot tools are unavailable/),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("API settings saved.")).toBeVisible();
  expect(saves).toEqual([
    { runtimeApi: true, runtimeIdleTimeout: 30, mcp: true },
  ]);
  await expect(page.getByText("Endpoint URL")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Status → Runtimes" }),
  ).toHaveAttribute("href", "/.dashboard/status?section=runtimes");
  await expect(
    page.getByRole("link", { name: "Status → Connected apps" }),
  ).toHaveAttribute("href", "/.dashboard/status?section=apps");
});
