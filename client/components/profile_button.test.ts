import { expect, test, vi } from "vitest";
import { profileMenuItems } from "./profile_button.tsx";

test("the signed-in profile menu links to the Dashboard", () => {
  const items = profileMenuItems(
    {
      status: "signed-in",
      username: "sample-user",
      admin: false,
      fullName: null,
    },
    {
      editProfile: vi.fn(),
      dashboard: vi.fn(),
      logIn: vi.fn(),
      logOut: vi.fn(),
    },
  );

  expect(items.map((item) => item.name)).toEqual([
    "Edit profile",
    "Dashboard",
    "Log out",
  ]);
});
