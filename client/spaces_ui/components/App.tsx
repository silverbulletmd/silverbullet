import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Alert } from "@silverbulletmd/silverbullet/ui";
import { api, formatApiError, getSession } from "../api.ts";
import {
  NavigateProvider,
  shouldIntercept,
  useSpacesRouter,
} from "../navigation.ts";
import { loginUrl, safeSpacesDestination, spacesUrl } from "../routes.ts";
import type { SpacesRoute } from "../routes.ts";
import type { AuthState } from "../types.ts";
import { Login } from "./Login.tsx";
import { SpaceEditor } from "./SpaceEditor.tsx";
import { SpaceList } from "./SpaceList.tsx";
import { NewUser, UserDetail, UserList } from "./UsersView.tsx";

type ScreenProps = {
  route: SpacesRoute;
  auth: Extract<AuthState, { phase: "authed" }>;
  onUnauthorized: () => void;
};

type Screen = { view: ComponentType<ScreenProps>; admin: boolean };

// Thin adapters: each narrows `route` to its own variant and calls the existing
// component unchanged. Keeping the components' own signatures means this table
// adds indirection only where the route shape differs.
const SpaceListScreen = ({ auth, onUnauthorized }: ScreenProps) => (
  <SpaceList admin={auth.admin} onUnauthorized={onUnauthorized} />
);
const SpaceNewScreen = ({ onUnauthorized }: ScreenProps) => (
  <SpaceEditor onUnauthorized={onUnauthorized} />
);
const SpaceEditScreen = ({ route, onUnauthorized }: ScreenProps) => (
  <SpaceEditor
    id={(route as Extract<SpacesRoute, { screen: "space" }>).id}
    onUnauthorized={onUnauthorized}
  />
);
const UserListScreen = ({ auth, onUnauthorized }: ScreenProps) => (
  <UserList currentUsername={auth.username} onUnauthorized={onUnauthorized} />
);
const UserNewScreen = ({ onUnauthorized }: ScreenProps) => (
  <NewUser onUnauthorized={onUnauthorized} />
);
const UserDetailScreen = ({ route, auth, onUnauthorized }: ScreenProps) => (
  <UserDetail
    username={(route as Extract<SpacesRoute, { screen: "user" }>).username}
    currentUsername={auth.username}
    onUnauthorized={onUnauthorized}
  />
);

// Keyed on SpacesRoute["screen"], so TypeScript requires an entry for every
// route variant: adding a route without deciding its admin requirement is a
// compile error rather than a silently public screen.
//
// `admin` is a DISPLAY decision, not a security boundary. Every screen's data
// comes from `api/admin/*`, which authorizes server-side on every request.
const SCREENS: Record<SpacesRoute["screen"], Screen | undefined> = {
  spaces: { view: SpaceListScreen, admin: false },
  "space-new": { view: SpaceNewScreen, admin: true },
  space: { view: SpaceEditScreen, admin: true },
  users: { view: UserListScreen, admin: true },
  "user-new": { view: UserNewScreen, admin: true },
  user: { view: UserDetailScreen, admin: true },
  login: undefined, // handled by the auth gate before this table is consulted
  "not-found": undefined,
};

export function App() {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const { route, navigate } = useSpacesRouter();

  // One delegated listener rather than a link component: every in-app link is
  // a real <a href> that works without JS, and this upgrades them in place.
  // `shouldIntercept` leaves modifier-clicks, new-tab targets and links out of
  // the Space Manager (a space's own URL) to the browser.
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
        if (route.screen === "login") {
          location.replace(route.next ?? spacesUrl("/"));
          return;
        }
        setAuth({ phase: "authed", username, admin });
      })
      .catch((error: any) => {
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
        onDone={() => {
          const next =
            route.screen === "login"
              ? safeSpacesDestination(route.next ?? null)
              : undefined;
          location.assign(next ?? spacesUrl("/"));
        }}
      />
    );
  }

  const onUnauthorized = () => location.replace(loginUrl());
  const onSpacesTab = route.screen.startsWith("space");
  const onUsersTab = route.screen.startsWith("user");
  return (
    <NavigateProvider value={navigate}>
      <div class="sb-spaces-header">
        <div class="sb-spaces-header-left">
          <strong class="sb-wordmark">
            {/* The dock icon, in the small copy meant for inline use (see
                client/images/README.md). `alt` is empty on purpose: the
                wordmark beside it already says "SilverBullet", so a
                description here would only make screen readers announce the
                name twice. */}
            <img src="assets/logo-dock-96x96.png" alt="" />
            SilverBullet
          </strong>
          {/* The active tab is what names the current screen — the list screens
              dropped their headings rather than repeat it — so it carries
              `aria-current` and not just a highlight class. */}
          {auth.admin && (
            <nav class="sb-tabs" aria-label="Administration">
              <a
                class={`sb-tab ${onSpacesTab ? "sb-active" : ""}`}
                aria-current={onSpacesTab ? "page" : undefined}
                href={spacesUrl("/")}
              >
                Spaces
              </a>
              <a
                class={`sb-tab ${onUsersTab ? "sb-active" : ""}`}
                aria-current={onUsersTab ? "page" : undefined}
                href={spacesUrl("/users")}
              >
                Users
              </a>
            </nav>
          )}
        </div>
        <button
          type="button"
          class="sb-link-button sb-logout"
          onClick={async () => {
            try {
              await api("GET", "api/logout");
              location.assign(spacesUrl("/login"));
            } catch (error: any) {
              if (error.unauthorized) onUnauthorized();
            }
          }}
        >
          Log out
        </button>
      </div>
      {(() => {
        const screen = SCREENS[route.screen];
        if (!screen || (screen.admin && !auth.admin)) {
          return (
            <div>
              <h1>Not found</h1>
              <p>This page does not exist.</p>
              <p>
                <a href={spacesUrl("/")}>Return to spaces</a>
              </p>
            </div>
          );
        }
        const View = screen.view;
        return (
          <View route={route} auth={auth} onUnauthorized={onUnauthorized} />
        );
      })()}
    </NavigateProvider>
  );
}
