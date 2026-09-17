import type { GitDraft } from "../../client/dashboard/types.ts";
import { expect, origin, test } from "../fixtures.ts";

test("draft editing invalidates a late check and Cancel preserves the active connection", async ({
  page,
}) => {
  const activeUrl = "git@example.org:team/original.git";
  let draft: GitDraft = {
    id: "draft-1",
    version: 1,
    url: activeUrl,
    mode: "key",
    pullIntervalSecs: 300,
    publicKey: "ssh-ed25519 sample-key",
    fingerprint: "SHA256:sample",
  };
  let finishCheck!: () => void;
  const waitCheck = new Promise<void>((resolve) => {
    finishCheck = resolve;
  });
  let checkStarted = false;
  let deleted = false;
  await page.route("**/.dashboard/api/admin/spaces/sample**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/git/draft") && method === "POST")
      return route.fulfill({ json: draft });
    if (path.endsWith("/test")) {
      checkStarted = true;
      const checked = {
        ...draft,
        test: {
          reachable: true,
          writable: true,
          kind: "ok",
          message: "",
          checkedUrl: draft.url,
          checkedAt: Date.now(),
          unrelated: false,
        },
      };
      await waitCheck;
      return route.fulfill({ json: checked });
    }
    if (path.endsWith("/draft/draft-1") && method === "PUT") {
      draft = {
        ...draft,
        ...route.request().postDataJSON(),
        version: draft.version + 1,
      };
      return route.fulfill({ json: draft });
    }
    if (path.endsWith("/draft/draft-1") && method === "DELETE") {
      deleted = true;
      draft = { ...draft, url: activeUrl, test: undefined };
      return route.fulfill({ json: { status: "ok" } });
    }
    if (path.endsWith("/git"))
      return route.fulfill({
        json: {
          remoteUrl: activeUrl,
          branch: "main",
          remoteName: "origin",
          credentialMode: "key",
          publicKey: null,
          fingerprint: null,
          ahead: 0,
          behind: 0,
          sync: { state: "idle" },
          enabled: true,
          paused: false,
          version: 1,
          lastSuccess: null,
          lastAttempt: null,
        },
      });
    if (path.endsWith("/sample"))
      return route.fulfill({
        json: {
          name: "Notebook",
          binding: { prefix: "/notebook" },
          folder: "spaces/notebook",
          shell: { enabled: false, whitelist: [] },
          revisions: "managed",
        },
      });
    throw new Error(`Unexpected connection mutation: ${method} ${path}`);
  });
  await page.goto(`${origin}/.dashboard/sample/git`);
  await page.getByRole("button", { name: "Edit connection" }).click();
  const revisionsLink = page.getByRole("link", {
    name: "Revisions",
    exact: true,
  });
  await expect(revisionsLink).not.toHaveAttribute("data-dirty", "true");
  await page
    .getByLabel("Repository", { exact: true })
    .fill("git@example.org:team/temporary.git");
  await expect(revisionsLink).toHaveAttribute("data-dirty", "true");
  await page.getByLabel("Repository", { exact: true }).fill(activeUrl);
  await expect(revisionsLink).not.toHaveAttribute("data-dirty", "true");
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeDisabled();

  await page
    .getByLabel("Repository", { exact: true })
    .fill("git@example.org:team/candidate.git");
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect.poll(() => checkStarted).toBe(true);
  await page
    .getByLabel("Repository", { exact: true })
    .fill("git@example.org:team/newer.git");
  finishCheck();
  await expect(
    page.getByRole("button", { name: "Check connection", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Connection check" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "General", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  expect(deleted).toBe(false);
  await page.getByRole("link", { name: "Revisions", exact: true }).click();
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue(
    "git@example.org:team/newer.git",
  );
  let warned = false;
  page.once("dialog", async (dialog) => {
    warned = true;
    expect(dialog.message()).toContain("Discard your unsaved space settings");
    await dialog.dismiss();
  });
  await expect(
    page.getByRole("link", { name: "← Dashboard", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Spaces", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/.dashboard/sample?section=revisions`);
  expect(warned).toBe(true);
  expect(deleted).toBe(false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: activeUrl })).toBeVisible();
  expect(deleted).toBe(true);
  await page.getByRole("button", { name: "Edit connection" }).click();
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue(
    activeUrl,
  );
});
