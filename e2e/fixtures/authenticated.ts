import type { Page } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  test as core,
  expect,
  type SBServer,
} from "./core.ts";

export const test = core.extend<{ adminPage: Page }>({
  provisionAdmin: true,
  adminPage: async ({ page, sbServer }, use) => {
    const response = await page.request.post(
      `${sbServer.url}/.spaces/api/login`,
      {
        data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
      },
    );
    expect(response.ok()).toBe(true);
    await use(page);
  },
});

export async function adminApi<T = any>(
  page: Page,
  server: SBServer,
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(
    `${server.url}/.spaces/api/admin/${path}`,
    { method, data },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

export async function login(
  page: Page,
  server: SBServer,
  username = ADMIN_USER,
  password = ADMIN_PASSWORD,
) {
  await page.goto(`${server.url}/.spaces/login`);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(`${server.url}/.spaces/`);
}
