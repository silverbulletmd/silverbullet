import type { FunctionalComponent } from "preact";
import * as featherIcons from "preact-feather";
import type { Client } from "../client.ts";
import { initials, type ProfileState } from "../profile.ts";
import type { MenuItem } from "./anchored_menu.tsx";

const LOGOUT_URL = "/.spaces/api/logout";

export function ProfileAvatar(
  profile: ProfileState,
): FunctionalComponent<{ size?: number }> {
  return function ProfileAvatarIcon({ size = 18 }: { size?: number }) {
    if (profile.status === "unavailable") {
      // A failed profile request should never claim you're signed in or out.
      return null;
    }
    if (profile.status === "signed-out") {
      return (
        <span
          className="sb-profile-avatar sb-profile-avatar-signed-out"
          style={{ width: `${size}px`, height: `${size}px` }}
        >
          <featherIcons.User size={Math.round(size * 0.6)} />
        </span>
      );
    }
    return (
      <span
        className="sb-profile-avatar sb-profile-avatar-signed-in"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${Math.round(size * 0.42)}px`,
        }}
      >
        {initials(profile)}
      </span>
    );
  };
}

/** The filter box's `label`, i.e. the mobile menu's only "who am I" header. */
export function profileMenuLabel(profile: ProfileState): string {
  if (profile.status !== "signed-in") {
    return "Not signed in";
  }
  return profile.fullName
    ? `${profile.fullName} (${profile.username})`
    : profile.username;
}

/** The desktop menu's two-line header; same data as {@link profileMenuLabel}. */
export function profileMenuHeader(profile: ProfileState): {
  title: string;
  subtitle?: string;
} {
  if (profile.status !== "signed-in") {
    return { title: "Not signed in" };
  }
  return profile.fullName
    ? { title: profile.fullName, subtitle: profile.username }
    : { title: profile.username };
}

export function profileMenuItems(
  profile: ProfileState,
  client: Client,
): MenuItem[] {
  if (profile.status !== "signed-in") {
    return [
      {
        name: "Log in",
        run: () => {
          location.href = `.auth?from=${encodeURIComponent(location.pathname)}`;
        },
      },
    ];
  }
  return [
    {
      name: "Edit profile",
      run: () => {
        client.openUrl("/.spaces/profile");
      },
    },
    {
      name: "All spaces",
      run: () => {
        location.href = "/.spaces";
      },
    },
    {
      name: "Log out",
      run: () => {
        void (async () => {
          let response: Response;
          try {
            response = await fetch(LOGOUT_URL);
          } catch {
            client.ui.flashNotification("Could not log out", "error");
            return;
          }
          if (!response.ok) {
            client.ui.flashNotification("Could not log out", "error");
            return;
          }
          try {
            await client.wipeClient();
          } catch (e: any) {
            console.error("Wiping local data after logout failed", e);
          }
          location.href = ".auth";
        })();
      },
    },
  ];
}
