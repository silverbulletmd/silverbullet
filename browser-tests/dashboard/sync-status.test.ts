import { expect, origin, test } from "../fixtures.ts";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const GAMMA = "33333333-3333-4333-8333-333333333333";

function space(name: string, mode: "off" | "key" | "manual") {
  return {
    name,
    folder: name.toLowerCase(),
    binding: { prefix: `/${name.toLowerCase()}` },
    access: "none",
    revisions: "managed",
    gitSync: { mode, pullIntervalSecs: 60 },
  };
}

test("Status → Sync lists git-synced spaces, problems first", async ({
  page,
}) => {
  await page.route("**/.dashboard/api/admin/spaces", (route) =>
    route.fulfill({
      json: {
        [ALPHA]: space("Alpha", "key"),
        [BETA]: space("Beta", "off"),
        [GAMMA]: space("Gamma", "manual"),
      },
    }),
  );
  await page.route(`**/.dashboard/api/admin/spaces/${ALPHA}/git`, (route) =>
    route.fulfill({
      json: {
        remoteUrl: "git@example.test:alpha.git",
        remoteName: "origin",
        branch: "main",
        remoteBranch: "main",
        credentialMode: "key",
        publicKey: null,
        fingerprint: null,
        ahead: 2,
        behind: 0,
        sync: { state: "idle" },
        lastSuccess: 1_700_000_000_000,
        enabled: true,
        paused: false,
      },
    }),
  );
  await page.route(`**/.dashboard/api/admin/spaces/${GAMMA}/git`, (route) =>
    route.fulfill({ status: 500, json: { errors: [{ message: "boom" }] } }),
  );
  await page.goto(`${origin}/.dashboard/status?section=sync`);
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Gamma");
  await expect(rows.nth(0)).toContainText("Status unavailable");
  await expect(rows.nth(1)).toContainText("Alpha");
  await expect(page.locator("thead th")).toHaveText([
    "Space",
    "State",
    "Last successful sync",
    "Outgoing",
    "Incoming",
  ]);
  await expect(rows.nth(1).locator("td")).toHaveText([
    "Alpha",
    "Changes waiting",
    /2023/,
    "2",
    "0",
  ]);
  await expect(page.getByText("Beta")).toHaveCount(0);
  await expect(
    rows.nth(0).getByRole("link", { name: "Gamma" }),
  ).toHaveAttribute("href", `/.dashboard/${GAMMA}?section=revisions`);
});

test("Status → Sync says when no space syncs with git", async ({ page }) => {
  await page.goto(`${origin}/.dashboard/status?section=sync`);
  await expect(page.getByText("No spaces sync with Git.")).toBeVisible();
});

test("Status → Sync waits for a slow refresh instead of piling up", async ({
  page,
}) => {
  await page.clock.install();
  let listRequests = 0;
  await page.route("**/.dashboard/api/admin/spaces", (route) => {
    listRequests++;
    return route.fulfill({ json: { [ALPHA]: space("Alpha", "key") } });
  });
  // The space's git status never answers: the first refresh stays in flight.
  await page.route(`**/.dashboard/api/admin/spaces/${ALPHA}/git`, () => {});
  await page.goto(`${origin}/.dashboard/status?section=sync`);
  await expect.poll(() => listRequests).toBe(1);
  await page.clock.runFor(16_000);
  expect(listRequests).toBe(1);
});
