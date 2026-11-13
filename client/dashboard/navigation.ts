import { createContext } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/hooks";
import {
  DASHBOARD_BASE,
  type DashboardRoute,
  parseDashboardRoute,
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

/** A history entry of this app, and where it was entered from. */
type Entry = {
  url: string;
  index: number;
  /** The screen this one was opened from; kept across a section switch. */
  origin?: { url: string; index: number };
};

const pathOf = (url: string) =>
  new URL(url, location.href).pathname.replace(/\/+$/, "");

/** Where a screen at `url`, opened from `from`, counts as entered from. */
export function originFor(from: Entry, url: string): Entry["origin"] {
  // Another section of the same screen (`?section=…`) keeps the screen's origin
  if (pathOf(url) === pathOf(from.url)) return from.origin;
  return { url: from.url, index: from.index };
}

let current: Entry | undefined;

/**
 * After a save, go back to the list at `listUrl` when the current screen was
 * entered from it, as the browser's Back would, so it keeps its scroll
 * position. False (and nothing happens) when it was entered some other way,
 * such as a link or a typed address: then the screen stays.
 */
export function returnToList(listUrl: string): boolean {
  const origin = current?.origin;
  if (!current || !origin || pathOf(origin.url) !== pathOf(listUrl)) {
    return false;
  }
  history.go(origin.index - current.index);
  return true;
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
  const entry = useRef<Entry>({
    url: `${location.pathname}${location.search}`,
    index: history.state?.dashboardIndex ?? 0,
    origin: history.state?.dashboardOrigin,
  });

  const enter = (next: Entry) => {
    entry.current = next;
    current = next;
  };

  useEffect(() => {
    current = entry.current;
    history.replaceState(
      {
        ...history.state,
        dashboardIndex: entry.current.index,
        dashboardOrigin: entry.current.origin,
      },
      "",
    );
    const onPopState = (event: PopStateEvent) => {
      const index = event.state?.dashboardIndex;
      if (index === entry.current.index) return;
      if (!canNavigate(`${location.pathname}${location.search}`)) {
        if (typeof index === "number") history.go(entry.current.index - index);
        else
          history.pushState(
            {
              dashboardIndex: entry.current.index,
              dashboardOrigin: entry.current.origin,
            },
            "",
            entry.current.url,
          );
        return;
      }
      enter({
        url: `${location.pathname}${location.search}`,
        index: index ?? 0,
        origin: event.state?.dashboardOrigin,
      });
      setRoute(parseDashboardRoute());
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback<Navigate>((url) => {
    if (url === `${location.pathname}${location.search}`) return;
    if (!canNavigate(url)) return;
    const origin = originFor(entry.current, url);
    enter({ url, index: entry.current.index + 1, origin });
    history.pushState(
      { dashboardIndex: entry.current.index, dashboardOrigin: origin },
      "",
      url,
    );
    setRoute(parseDashboardRoute());
    // A screen change is a fresh page as far as the reader is concerned; a
    // long list left the next screen scrolled into its middle.
    scrollTo(0, 0);
  }, []);

  return { route, navigate };
}
