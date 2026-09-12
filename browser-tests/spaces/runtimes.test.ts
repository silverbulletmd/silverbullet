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
  await page.route("**/.spaces/api/admin/runtimes**", async (route) => {
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
  await page.goto(`${origin}/.spaces/admin?section=runtimes`);
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

test("polling pauses when hidden and ignores a sample fetched before Stop", async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  let stopped = false;
  let releaseSample: (() => void) | undefined;
  await page.route("**/.spaces/api/admin/runtimes**", async (route) => {
    if (route.request().method() === "POST") {
      stopped = true;
      return route.fulfill({ status: 204 });
    }
    requests++;
    const status = stopped ? "stopped" : "running";
    if (requests === 2)
      await new Promise<void>((resolve) => {
        releaseSample = resolve;
      });
    await route.fulfill({
      json: [
        {
          id: "runtime-two",
          spaceId: "garden",
          spaceName: "Garden",
          username: "rowan",
          status,
          cpuPercent: null,
          memoryBytes: null,
          diskBytes: null,
        },
      ],
    });
  });
  await page.goto(`${origin}/.spaces/admin?section=runtimes`);
  const row = page.getByRole("row").filter({ hasText: "Garden" });
  await expect(row).toContainText("rowan");
  await expect(
    row.getByRole("cell", { name: "Unavailable", exact: true }),
  ).toHaveCount(3);
  await page.clock.fastForward(3000);
  await expect.poll(() => requests).toBe(2);
  await page.clock.fastForward(9000);
  expect(requests).toBe(2);
  await row.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => stopped).toBe(true);
  releaseSample!();
  await expect(row).toContainText("stopped");
  await expect.poll(() => requests).toBe(3);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(9000);
  expect(requests).toBe(3);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(4);
  await page.getByRole("link", { name: "Server", exact: true }).click();
  await page.clock.fastForward(9000);
  expect(requests).toBe(4);
});
