import { expect, origin, test } from "../fixtures.ts";

test("a new primary URL reopens Settings → Server on that origin", async ({
  page,
}) => {
  let config = {
    primaryUrl: null as string | null,
    serverName: "SilverBullet",
  };
  await page.route("**/.dashboard/api/admin/server-config", (route) => {
    if (route.request().method() === "PUT")
      config = { ...config, ...route.request().postDataJSON() };
    return route.fulfill({ json: config });
  });
  let reopened = "";
  await page.route("http://other.test/**", (route) => {
    reopened = route.request().url();
    return route.fulfill({ contentType: "text/html", body: "" });
  });
  await page.goto(`${origin}/.dashboard/settings?section=server`);
  await page.getByLabel("Server address").fill("http://other.test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => reopened)
    .toBe("http://other.test/.dashboard/settings?section=server");
});
