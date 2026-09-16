import { expect, test } from "@playwright/test";
import { coreApi, startCoreOidcFixture } from "./core-fixture.ts";

test("primary Dashboard isolates administration from sibling and cross-site space origins", async () => {
  test.setTimeout(180_000);
  const fixture = await startCoreOidcFixture({ disableServiceWorker: false });
  const { adminPage, oidc } = fixture;
  const serverRequest = (url: string) => {
    const parsed = new URL(url);
    return adminPage.request.get(
      `http://127.0.0.1:${fixture.corePort}${parsed.pathname}`,
      {
        headers: { Host: parsed.host, "X-Forwarded-Proto": "https" },
        maxRedirects: 0,
      },
    );
  };
  try {
    await coreApi(adminPage, "PUT", "admin/server-config", {
      primaryUrl: oidc.centralOrigin,
    });
    const sibling = new URL(oidc.centralOrigin);
    sibling.hostname = "space.sb.test";
    for (const host of ["space.sb.test", "notes.test"]) {
      await coreApi(adminPage, "POST", "admin/spaces", {
        name: host,
        binding: { host },
        access: "read",
      });
    }
    const originConfig = await serverRequest(
      `${oidc.notesOrigin}/.auth/central/public`,
    );
    expect((await originConfig.json()).primaryUrl).toBe(oidc.centralOrigin);
    for (const space of [sibling.origin, oidc.notesOrigin]) {
      const direct = await serverRequest(`${space}/.dashboard/api/admin/users`);
      expect(direct.status()).toBe(403);
      const sso = await serverRequest(
        `${space}/.dashboard/api/admin/authentication`,
      );
      expect(sso.status()).toBe(403);
      const navigation = await serverRequest(`${space}/.dashboard/profile`);
      expect(navigation.headers().location).toBe(
        `${oidc.centralOrigin}/.dashboard/profile`,
      );
      const hostile = await adminPage.context().newPage();
      await hostile.route(`${space}/probe`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Space script probe</title>",
        }),
      );
      await hostile.goto(`${space}/probe`);
      const results = await hostile.evaluate(async (primary) => {
        const read = await fetch(`${primary}/.dashboard/api/admin/users`, {
          credentials: "include",
        })
          .then((r) => r.status)
          .catch(() => "blocked");
        const write = await fetch(
          `${primary}/.dashboard/api/admin/server-config`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              primaryUrl: "https://changed.example.test",
            }),
          },
        )
          .then((r) => r.status)
          .catch(() => "blocked");
        const logout = await fetch(`${primary}/.dashboard/api/logout`, {
          credentials: "include",
        })
          .then((r) => r.status)
          .catch(() => "blocked");
        return { read, write, logout };
      }, oidc.centralOrigin);
      expect(results).toEqual({
        read: "blocked",
        write: "blocked",
        logout: "blocked",
      });
      await hostile.close();
    }
    expect(
      (
        await coreApi<{ primaryUrl: string }>(
          adminPage,
          "GET",
          "admin/server-config",
        )
      ).primaryUrl,
    ).toBe(oidc.centralOrigin);
    expect(
      (await serverRequest(`${oidc.centralOrigin}/.config`)).status(),
    ).toBe(404);
  } finally {
    await fixture.stop();
  }
});
