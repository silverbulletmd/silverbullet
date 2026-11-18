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
import { SettingsView } from "./SettingsView.tsx";
import { StatusView } from "./status/StatusView.tsx";
import { Login } from "./Login.tsx";
import { ProfileView } from "./ProfileView.tsx";
import { SpaceEditor } from "./SpaceEditor.tsx";
import { SpaceList } from "./SpaceList.tsx";
import { DashboardProfileMenu } from "./DashboardProfileMenu.tsx";
import { UpdateNotice } from "./UpdateNotice.tsx";
import { NewUser, UserDetail, UserList } from "./UsersView.tsx";

type ScreenProps<R extends DashboardRoute = DashboardRoute> = {
  route: R;
  auth: Extract<AuthState, { phase: "authed" }>;
  onUnauthorized: () => void;
};

type Screen<R extends DashboardRoute> = {
  view: ComponentType<ScreenProps<R>>;
  admin: boolean;
  /** The sidebar item that stays highlighted on this screen. */
  nav: "spaces" | "users" | "profile" | "settings" | "status";
};
type ScreenFor<K extends DashboardRoute["screen"]> = Screen<
  Extract<DashboardRoute, { screen: K }>
>;

const SpaceEditScreen = ({
  route,
  onUnauthorized,
}: ScreenProps<Extract<DashboardRoute, { screen: "space" | "space-git" }>>) => (
  <SpaceEditor
    key={route.id}
    id={route.id}
    section={
      route.screen === "space-git" ? "revisions" : (route.section ?? "general")
    }
    onUnauthorized={onUnauthorized}
  />
);

// These flags control navigation; API requests enforce authorization independently.
const SCREENS: {
  [K in DashboardRoute["screen"]]: ScreenFor<K> | undefined;
} = {
  spaces: {
    view: ({ auth, onUnauthorized }) => (
      <SpaceList admin={auth.admin} onUnauthorized={onUnauthorized} />
    ),
    admin: false,
    nav: "spaces",
  },
  "space-new": {
    view: ({ onUnauthorized }) => (
      <SpaceEditor onUnauthorized={onUnauthorized} />
    ),
    admin: true,
    nav: "spaces",
  },
  space: { view: SpaceEditScreen, admin: true, nav: "spaces" },
  "space-git": { view: SpaceEditScreen, admin: true, nav: "spaces" },
  users: {
    view: ({ auth, onUnauthorized }) => (
      <UserList
        currentUsername={auth.username}
        onUnauthorized={onUnauthorized}
      />
    ),
    admin: true,
    nav: "users",
  },
  "user-new": {
    view: ({ onUnauthorized }) => <NewUser onUnauthorized={onUnauthorized} />,
    admin: true,
    nav: "users",
  },
  user: {
    view: ({ route, auth, onUnauthorized }) => (
      <UserDetail
        username={route.username}
        currentUsername={auth.username}
        onUnauthorized={onUnauthorized}
      />
    ),
    admin: true,
    nav: "users",
  },
  settings: {
    view: ({ route, onUnauthorized }) => (
      <SettingsView section={route.section} onUnauthorized={onUnauthorized} />
    ),
    admin: true,
    nav: "settings",
  },
  status: {
    view: ({ route, onUnauthorized }) => (
      <StatusView section={route.section} onUnauthorized={onUnauthorized} />
    ),
    admin: true,
    nav: "status",
  },
  profile: {
    view: ({ onUnauthorized }) => (
      <ProfileView onUnauthorized={onUnauthorized} />
    ),
    admin: false,
    nav: "profile",
  },
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
  // The table is keyed by screen, so each entry matches its own route.
  const screen = SCREENS[route.screen] as Screen<DashboardRoute> | undefined;
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
            active={screen?.nav ?? ""}
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
                      id: "settings",
                      label: "Settings",
                      href: dashboardUrl("/settings"),
                    },
                    {
                      id: "status",
                      label: "Status",
                      href: dashboardUrl("/status"),
                    },
                  ]
                : []),
            ]}
            onSelect={() => {}}
          />
        </aside>
        {(() => {
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
          return (
            <div class="sb-management-main">
              {auth.admin && <UpdateNotice />}
              {view}
            </div>
          );
        })()}
      </div>
    </NavigateProvider>
  );
}
