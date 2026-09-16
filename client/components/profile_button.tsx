import {
  dashboardUrl,
  dashboardSessionRoutes,
} from "../dashboard_navigation.ts";
import type { FunctionalComponent } from "preact";
import * as featherIcons from "preact-feather";
import type { Client } from "../client.ts";
import {
  logoutBrowserSession,
  saveCurrentEditor,
  LogoutSyncError,
  forceLogoutWarning,
} from "../logout.ts";
import { initials, type ProfileState } from "../profile.ts";
import type { MenuItem } from "./anchored_menu.tsx";

export function ProfileAvatar(
  profile: ProfileState,
): FunctionalComponent<{ size?: number }> {
  return function ProfileAvatarIcon({ size = 18 }: { size?: number }) {
    if (profile.status === "unavailable") {
      // A failed profile request should never claim you're signed in or out.
      return null;
    }
    size = Math.max(26, size);
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

export type ProfileMenuActions = {
  editProfile: () => void;
  dashboard: () => void;
  logIn: () => void;
  logOut: () => void;
};

export function profileMenuItems(
  profile: ProfileState,
  actions: ProfileMenuActions,
): MenuItem[] {
  if (profile.status !== "signed-in") {
    return [{ name: "Log in", run: actions.logIn }];
  }
  return [
    { name: "Edit profile", run: actions.editProfile },
    { name: "Dashboard", run: actions.dashboard },
    { name: "Log out", run: actions.logOut },
  ];
}

export function editorProfileMenuItems(
  profile: ProfileState,
  client: Client,
): MenuItem[] {
  return profileMenuItems(profile, {
    logIn: () => {
      location.href = `.auth?from=${encodeURIComponent(location.pathname)}`;
    },
    editProfile: async () => client.openUrl(await dashboardUrl("/profile")),
    dashboard: async () => {
      location.href = await dashboardUrl();
    },
    logOut: async () => {
      const { logout } = await dashboardSessionRoutes();
      const force = async () => {
        if (!window.confirm(forceLogoutWarning)) return;
        try {
          await logoutBrowserSession(
            () => saveCurrentEditor(client),
            true,
            logout,
          );
        } catch (error) {
          client.ui.flashNotification(
            error instanceof Error ? error.message : "Could not log out",
            "error",
          );
        }
      };
      try {
        await logoutBrowserSession(
          () => saveCurrentEditor(client),
          false,
          logout,
        );
      } catch (error) {
        client.ui.flashNotification(
          error instanceof Error ? error.message : "Could not log out",
          "error",
          error instanceof LogoutSyncError
            ? { timeout: 0, actions: [{ name: "Force logout", run: force }] }
            : undefined,
        );
      }
    },
  });
}
