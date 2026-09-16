import {
  logoutBrowserSession,
  LogoutSyncError,
  forceLogoutWarning,
  logoutInProgress,
  registerLogoutParticipant,
} from "../../logout.ts";
import { useServerName } from "../server_name.ts";
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Alert, Button, SectionNav } from "@silverbulletmd/silverbullet/ui";
import { formatApiError, getSession } from "../api.ts";
import {
  NavigateProvider,
  canNavigate,
  shouldIntercept,
  useDashboardRouter,
} from "../navigation.ts";
import { loginUrl, safeDashboardDestination, dashboardUrl } from "../routes.ts";
import type { DashboardRoute } from "../routes.ts";
import type { AuthState } from "../types.ts";
import { AdminView } from "./AdminView.tsx";
import { Login } from "./Login.tsx";
import { ProfileView } from "./ProfileView.tsx";
import { SpaceEditor } from "./SpaceEditor.tsx";
import { SpaceList } from "./SpaceList.tsx";
import { DashboardProfileMenu } from "./DashboardProfileMenu.tsx";
import { NewUser, UserDetail, UserList } from "./UsersView.tsx";

type ScreenProps = {
  route: DashboardRoute;
  auth: Extract<AuthState, { phase: "authed" }>;
  onUnauthorized: () => void;
};

type Screen = { view: ComponentType<ScreenProps>; admin: boolean };

const SpaceListScreen = ({ auth, onUnauthorized }: ScreenProps) => (
  <SpaceList admin={auth.admin} onUnauthorized={onUnauthorized} />
);
const SpaceNewScreen = ({ onUnauthorized }: ScreenProps) => (
  <SpaceEditor onUnauthorized={onUnauthorized} />
);
const SpaceEditScreen = ({ route, onUnauthorized }: ScreenProps) => {
  const settings = route as Extract<
    DashboardRoute,
    { screen: "space" | "space-git" }
  >;
  return (
    <SpaceEditor
      key={settings.id}
      id={settings.id}
      section={
        settings.screen === "space-git"
          ? "revisions"
          : (settings.section ?? "general")
      }
      onUnauthorized={onUnauthorized}
    />
  );
};
const UserListScreen = ({ auth, onUnauthorized }: ScreenProps) => (
  <UserList currentUsername={auth.username} onUnauthorized={onUnauthorized} />
);
const UserNewScreen = ({ onUnauthorized }: ScreenProps) => (
  <NewUser onUnauthorized={onUnauthorized} />
);
const UserDetailScreen = ({ route, auth, onUnauthorized }: ScreenProps) => (
  <UserDetail
    username={(route as Extract<DashboardRoute, { screen: "user" }>).username}
    currentUsername={auth.username}
    onUnauthorized={onUnauthorized}
  />
);
const ProfileScreen = ({ onUnauthorized }: ScreenProps) => (
  <ProfileView onUnauthorized={onUnauthorized} />
);

const AdminScreen = ({ route, onUnauthorized }: ScreenProps) => (
  <AdminView
    section={route.screen === "admin" ? route.section : "server"}
    onUnauthorized={onUnauthorized}
  />
);

// These flags control navigation; API requests enforce authorization independently.
const SCREENS: Record<DashboardRoute["screen"], Screen | undefined> = {
  spaces: { view: SpaceListScreen, admin: false },
  "space-new": { view: SpaceNewScreen, admin: true },
  space: { view: SpaceEditScreen, admin: true },
  "space-git": { view: SpaceEditScreen, admin: true },
  users: { view: UserListScreen, admin: true },
  "user-new": { view: UserNewScreen, admin: true },
  user: { view: UserDetailScreen, admin: true },
  admin: { view: AdminScreen, admin: true },
  profile: { view: ProfileScreen, admin: false },
  login: undefined, // handled by the auth gate before this table is consulted
  "not-found": undefined,
};

export function App() {
  const serverName = useServerName();
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const { route, navigate } = useDashboardRouter();
  const [logoutError, setLogoutError] = useState("");
  const [canForceLogout, setCanForceLogout] = useState(false);
  async function logOut(force = false) {
    if (force && !window.confirm(forceLogoutWarning)) return;
    if (!canNavigate(dashboardUrl("/login"))) return;
    const previous = auth;
    setAuth({ phase: "loading" });
    setLogoutError("");
    setCanForceLogout(false);
    try {
      await logoutBrowserSession(async () => {}, force);
    } catch (error) {
      setAuth(previous);
      setLogoutError(
        error instanceof Error ? error.message : "Could not log out",
      );
      setCanForceLogout(error instanceof LogoutSyncError);
    }
  }
  useEffect(() => {
    const unregister = registerLogoutParticipant(async () => {});
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    window.addEventListener("pagehide", unregister);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", unregister);
      window.removeEventListener("pageshow", restore);
      unregister();
    };
  }, []);

  // One delegated listener rather than a link component: every in-app link is
  // a real <a href> that works without JS, and this upgrades them in place.
  // `shouldIntercept` leaves modifier-clicks, new-tab targets and links out of
  // the Dashboard (a space's own URL) to the browser.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor || !shouldIntercept(event, anchor)) return;
      event.preventDefault();
      const url = new URL(anchor.href, location.href);
      navigate(`${url.pathname}${url.search}`);
    };
    addEventListener("click", onClick);
    return () => removeEventListener("click", onClick);
  }, [navigate]);

  useEffect(() => {
    getSession()
      .then(({ username, admin }) => {
        if (logoutInProgress()) return;
        if (route.screen === "login") {
          location.replace(route.next ?? dashboardUrl("/"));
          return;
        }
        setAuth({ phase: "authed", username, admin });
      })
      .catch((error: any) => {
        if (logoutInProgress()) return;
        if (error.unauthorized) {
          if (route.screen === "login") setAuth({ phase: "login" });
          else location.replace(loginUrl());
        } else {
          setAuth({ phase: "error", message: formatApiError(error) });
        }
      });
  }, []);

  if (auth.phase === "loading") return <p>Loading…</p>;
  if (auth.phase === "error") {
    return <Alert variant="error">{auth.message}</Alert>;
  }
  if (auth.phase === "login") {
    return (
      <Login
        title={serverName}
        onDone={() => {
          const next =
            route.screen === "login"
              ? safeDashboardDestination(route.next ?? null)
              : undefined;
          location.assign(next ?? dashboardUrl("/"));
        }}
      />
    );
  }

  const onUnauthorized = () => {
    if (!logoutInProgress()) location.replace(loginUrl());
  };
  const onSpacesTab = route.screen.startsWith("space");
  const onUsersTab = route.screen.startsWith("user");
  const onAdminTab = route.screen === "admin";
  return (
    <NavigateProvider value={navigate}>
      <div class="sb-management">
        <header class="sb-management-header">
          <a class="sb-wordmark" href={dashboardUrl("/")}>
            <img src="assets/logo-dock-96x96.png" alt="" />
            <span title={serverName}>{serverName}</span>
          </a>
          <DashboardProfileMenu
            username={auth.username}
            admin={auth.admin}
            routeKey={`${location.pathname}${location.search}`}
            onUnauthorized={onUnauthorized}
            onLogout={() => logOut()}
          />
          {logoutError && (
            <Alert variant="error" class="sb-management-notice">
              {logoutError}
              {canForceLogout && (
                <>
                  <p>
                    Synchronization did not finish. Retry logout, or force
                    logout to discard unsynchronized edits.
                  </p>
                  <Button onClick={() => logOut()}>Retry logout</Button>
                  <Button onClick={() => logOut(true)}>Force logout</Button>
                </>
              )}
            </Alert>
          )}
        </header>
        <aside class="sb-management-sidebar">
          <SectionNav
            label="Sections"
            collapse={false}
            active={
              onSpacesTab
                ? "spaces"
                : onAdminTab
                  ? "admin"
                  : onUsersTab
                    ? "users"
                    : "profile"
            }
            navClass="sb-management-nav"
            itemClass="sb-management-nav-item"
            items={[
              { id: "spaces", label: "Spaces", href: dashboardUrl("/") },
              ...(auth.admin
                ? [
                    {
                      id: "users",
                      label: "Users",
                      href: dashboardUrl("/users"),
                    },
                  ]
                : []),
              {
                id: "profile",
                label: "Profile",
                href: dashboardUrl("/profile"),
              },
              ...(auth.admin
                ? [
                    {
                      id: "admin",
                      label: "Admin",
                      href: dashboardUrl("/admin"),
                    },
                  ]
                : []),
            ]}
            onSelect={() => {}}
          />
        </aside>
        {(() => {
          const screen = SCREENS[route.screen];
          if (!screen || (screen.admin && !auth.admin)) {
            return (
              <div class="sb-management-main">
                <h1>Not found</h1>
                <p>This page does not exist.</p>
                <p>
                  <a href={dashboardUrl("/")}>Return to spaces</a>
                </p>
              </div>
            );
          }
          const View = screen.view;
          const view = (
            <View route={route} auth={auth} onUnauthorized={onUnauthorized} />
          );
          return <div class="sb-management-main">{view}</div>;
        })()}
      </div>
    </NavigateProvider>
  );
}
