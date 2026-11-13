import { expect, origin, test } from "../fixtures.ts";

test("runtime metrics, stop, reset, and errors refresh the list", async ({
  page,
}) => {
  let rows = [
    {
      id: "runtime-one",
      spaceId: "fieldnotes",
      spaceName: "Field Notes",
      username: null,
      status: "running",
      cpuPercent: 125.5,
      memoryBytes: 1048576,
      diskBytes: 2048,
    },
  ];
  let failReset = true;
  await page.route("**/.dashboard/api/admin/runtimes**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: rows });
    if (request.url().endsWith("/runtime-one/stop")) {
      rows = rows.map((row) => ({
        ...row,
        status: "stopped",
        cpuPercent: 0,
        memoryBytes: 0,
      }));
      return route.fulfill({ status: 204 });
    }
    if (request.url().endsWith("/runtime-one/reset")) {
      if (failReset)
        return route.fulfill({
          status: 500,
          json: { errors: [{ field: "", message: "Profile cleanup failed" }] },
        });
      rows = [];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${origin}/.dashboard/admin?section=runtimes`);
  const row = page.getByRole("row").filter({ hasText: "Field Notes" });
  await expect(row).toContainText("Accountless");
  await expect(row).toContainText("125.5%");
  await expect(row).toContainText("1 MiB");
  await expect(row).toContainText("2 KiB");
  await row.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(row).toContainText("stopped");
  await expect(
    row.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await row.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByText("Profile cleanup failed")).toBeVisible();
  failReset = false;
  await row.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByText("No runtimes have been started.")).toBeVisible();
});
