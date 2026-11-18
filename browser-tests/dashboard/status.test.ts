import { expect, origin, test } from "../fixtures.ts";

test("admins see Status in the sidebar with its sub-tabs", async ({ page }) => {
  await page.route("**/.dashboard/api/admin/runtimes", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto(`${origin}/.dashboard/settings`);
  const nav = page.locator(".sb-management-nav");
  await expect(nav.getByRole("link")).toHaveText([
    "Spaces",
    "Users",
    "Profile",
    "Settings",
    "Status",
  ]);
  await nav.getByRole("link", { name: "Status" }).click();
  await expect(page).toHaveURL(`${origin}/.dashboard/status`);
  const tabs = page.getByRole("navigation", { name: "Status" });
  await expect(tabs.getByRole("link")).toHaveText([
    "Runtimes",
    "Connected apps",
    "Search",
    "Sync",
  ]);
  await tabs.getByRole("link", { name: "Connected apps" }).click();
  await expect(page).toHaveURL(`${origin}/.dashboard/status?section=apps`);
  await expect(page.getByText("No apps are connected.")).toBeVisible();
});

test("non-admins get neither the Status item nor the screen", async ({
  page,
}) => {
  await page.route(/\/api\/(session|profile)$/, (route) =>
    route.fulfill({
      json: { username: "fixture-member", admin: false, fullName: null },
    }),
  );
  await page.goto(`${origin}/.dashboard/status`);
  await expect(page.locator(".sb-management-nav")).toBeVisible();
  await expect(
    page.locator(".sb-management-nav").getByRole("link", { name: "Status" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Status" })).toHaveCount(0);
});

test("the former Admin address shows no Settings page", async ({ page }) => {
  // `/admin` now reads as a space id; that space doesn't exist.
  await page.route("**/.dashboard/api/admin/spaces/admin**", (route) =>
    route.fulfill({ status: 404, json: { errors: [] } }),
  );
  await page.goto(`${origin}/.dashboard/admin`);
  await expect(
    page.getByRole("navigation", { name: "Sections" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
});
