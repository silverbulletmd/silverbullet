import { expect, test } from "vitest";
import {
  dashboardUrl,
  dashboardSessionRoutes,
} from "./dashboard_navigation.ts";

const configured = async () =>
  new Response(
    JSON.stringify({ primaryUrl: "https://dashboard.example.test" }),
  );
test("dashboard links use the configured primary origin", async () => {
  expect(await dashboardUrl("/profile", configured)).toBe(
    "https://dashboard.example.test/.dashboard/profile",
  );
});
test("deployments without a primary URL use origin-relative dashboard links", async () => {
  expect(
    await dashboardUrl("", async () => new Response("", { status: 404 })),
  ).toBe("/.dashboard");
});
test("isolated space session operations stay on the space origin", async () => {
  expect(await dashboardSessionRoutes(configured)).toEqual({
    profile: "/.auth/central/profile",
    logout: {
      endpoint: "/.auth/central/logout",
      method: "POST",
      destination: "/.auth/central/signed-out",
    },
  });
});
