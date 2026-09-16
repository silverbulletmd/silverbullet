import {
  expect,
  origin as insecureOrigin,
  secureOrigin as origin,
  test,
} from "../fixtures.ts";

test("SSO is unavailable on an insecure HTTP origin", async ({ page }) => {
  await page.goto(`${insecureOrigin}/.dashboard/authentication`);
  expect(await page.evaluate(() => globalThis.isSecureContext)).toBe(false);
  await expect(page.getByText(/SSO requires HTTPS or localhost/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up SSO" })).toHaveCount(0);
});

test("wizard UI tests a saved draft before activation and preserves the local administrator", async ({
  page,
}) => {
  let draft: any = null;
  let active: any = null;
  const changes: string[] = [];
  const submittedSecrets: string[] = [];
  let testOutcome = "error";
  await page.route(`${origin}/.dashboard/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname.endsWith("/api/admin/authentication") && method === "GET")
      return route.fulfill({
        json: {
          revision: draft ? 1 : 0,
          enabled: !!active,
          active,
          draft,
          tested: false,
        },
      });
    if (pathname.endsWith("/authentication/draft")) {
      changes.push("save");
      const submitted = route.request().postDataJSON();
      expect(submitted).not.toHaveProperty("preset");
      submittedSecrets.push(submitted.clientSecret);
      draft = {
        ...submitted,
        clientSecret: "",
        hasClientSecret: true,
        providerId: "fixture-provider",
      };
      return route.fulfill({ json: { revision: 1 } });
    }
    if (pathname.endsWith("/authentication/test") && method === "POST") {
      changes.push("test");
      return route.fulfill({
        json: {
          id: "fixture-test",
          proof: "fixture-proof",
          url: `${origin}/provider-test`,
        },
      });
    }
    if (pathname.endsWith("/authentication/test/fixture-test"))
      return route.fulfill({
        json: {
          status: testOutcome,
          error: testOutcome === "error" ? "Email is not verified" : undefined,
          email: "fixture-user@example.test",
          emailVerified: true,
          admissionAllowed: true,
          provisionedUsername: null,
        },
      });
    if (pathname.endsWith("/authentication/activate")) {
      expect(route.request().postDataJSON().revision).toBe(1);
      changes.push("activate");
      active = draft;
      return route.fulfill({ json: {} });
    }
    return route.fallback();
  });
  await page.goto(`${origin}/.dashboard/authentication`);
  expect(await page.evaluate(() => globalThis.isSecureContext)).toBe(true);
  await page.getByRole("button", { name: "Set up SSO" }).click();
  await expect(
    page.getByLabel("Provider", { exact: true }).locator("option"),
  ).toHaveText(["Google Workspace", "OpenID Connect"]);
  await page.getByLabel("Provider", { exact: true }).selectOption("oidc");
  await page.getByLabel("Issuer URL").fill("https://provider.test");
  await page.getByLabel("Central login URL").fill(origin);
  await page.getByLabel("Client ID", { exact: true }).fill("fixture-client");
  await page
    .getByLabel("Client secret", { exact: true })
    .fill("fixture-secret");
  await expect(page.getByLabel("Callback URL")).toHaveValue(
    `${origin}/.auth/central/oidc/callback`,
  );
  await expect(page.getByRole("button", { name: "Enable SSO" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save and test sign-in" }).click();
  await expect(
    page.getByText("Email is not verified", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable SSO" })).toHaveCount(0);
  expect(changes).toEqual(["save", "test"]);
  testOutcome = "success";
  await page.getByRole("button", { name: "Save and test sign-in" }).click();
  await expect(
    page.getByText("fixture-user@example.test", { exact: true }),
  ).toBeVisible();
  expect(changes).toEqual(["save", "test", "save", "test"]);
  await page
    .getByLabel("Sign-in button label")
    .fill("Continue with Example SSO");
  await expect(page.getByRole("button", { name: "Enable SSO" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save and test sign-in" }).click();
  await expect(page.getByRole("button", { name: "Enable SSO" })).toBeVisible();
  await expect(
    page.getByText("Only accounts added by an administrator can sign in.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enable SSO" }).click();
  await expect(
    page.getByText("SSO is enabled.", { exact: true }),
  ).toBeVisible();
  expect(changes).toEqual([
    "save",
    "test",
    "save",
    "test",
    "save",
    "test",
    "activate",
  ]);
  expect(submittedSecrets).toEqual(["fixture-secret", "", ""]);
  await page.getByRole("button", { name: "Profile menu" }).click();
  await expect(page.getByText("fixture-admin", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Client secret", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("Client secret", { exact: true }),
  ).toHaveAttribute("placeholder", "Saved secret — leave blank to keep");
});
