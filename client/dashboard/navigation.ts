import { createContext } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/hooks";
import {
  parseDashboardRoute,
  DASHBOARD_BASE,
  type DashboardRoute,
} from "./routes.ts";

/** Navigate to another Dashboard screen without reloading the page. */
export type Navigate = (url: string) => void;

const NavigateContext = createContext<Navigate>(() => {});

let navigationGuard: ((url?: string) => boolean) | undefined;

export function setNavigationGuard(
  guard: (url?: string) => boolean,
): () => void {
  navigationGuard = guard;
  return () => {
    if (navigationGuard === guard) navigationGuard = undefined;
  };
}

export function canNavigate(url?: string): boolean {
  return navigationGuard?.(url) ?? true;
}

/**
 * In-app navigation. Falls back to a no-op outside the provider, which only
 * happens in tests rendering a screen in isolation.
 */
export function useNavigate(): Navigate {
  return useContext(NavigateContext);
}

export const NavigateProvider = NavigateContext.Provider;

/**
 * Whether a URL is another Dashboard screen, and so can be handled in
 * place. Links to the spaces *themselves* and to other origins are not: those
 * leave this app and must stay real navigations.
 */
export function isDashboardUrl(url: URL): boolean {
  // An empty base would make `startsWith` match every path on the origin.
  // Rather than guess, decline to intercept and let the browser navigate.
  if (!DASHBOARD_BASE) return false;
  if (url.origin !== location.origin) return false;
  const path = url.pathname.replace(/\/+$/, "");
  return path === DASHBOARD_BASE || path.startsWith(`${DASHBOARD_BASE}/`);
}

/**
 * Whether a click on an anchor should be handled in place. False for anything
 * the user has asked the browser to do itself — open in a new tab or window,
 * download — so modifier-clicking a link keeps working normally.
 */
export function shouldIntercept(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  return isDashboardUrl(new URL(anchor.href, location.href));
}

/**
 * The current screen, kept in sync with the address bar. `navigate` pushes a
 * history entry and re-renders; the browser's back and forward buttons work
 * because `popstate` re-parses the URL the same way the initial render did.
 */
export function useDashboardRouter(): {
  route: DashboardRoute;
  navigate: Navigate;
} {
  const [route, setRoute] = useState<DashboardRoute>(parseDashboardRoute);
  const current = useRef({
    url: `${location.pathname}${location.search}`,
    index: history.state?.dashboardIndex ?? 0,
  });

  useEffect(() => {
    history.replaceState(
      { ...history.state, dashboardIndex: current.current.index },
      "",
    );
    const onPopState = (event: PopStateEvent) => {
      const index = event.state?.dashboardIndex;
      if (index === current.current.index) return;
      if (!canNavigate(`${location.pathname}${location.search}`)) {
        if (typeof index === "number")
          history.go(current.current.index - index);
        else
          history.pushState(
            { dashboardIndex: current.current.index },
            "",
            current.current.url,
          );
        return;
      }
      current.current = {
        url: `${location.pathname}${location.search}`,
        index: index ?? 0,
      };
      setRoute(parseDashboardRoute());
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback<Navigate>((url) => {
    if (url === `${location.pathname}${location.search}`) return;
    if (!canNavigate(url)) return;
    current.current = { url, index: current.current.index + 1 };
    history.pushState({ dashboardIndex: current.current.index }, "", url);
    setRoute(parseDashboardRoute());
    // A screen change is a fresh page as far as the reader is concerned; a
    // long list left the next screen scrolled into its middle.
    scrollTo(0, 0);
  }, []);

  return { route, navigate };
}
