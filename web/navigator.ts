import {
  encodePageURI,
  parseRef,
  type Ref,
} from "../plug-api/lib/page_ref.ts";
import type { Client } from "./client.ts";
import { cleanPageRef } from "../plug-api/lib/resolve.ts";
import { safeRun } from "../lib/async.ts";
import { luaBuildStandardEnv } from "../common/space_lua/stdlib.ts";
import { LuaStackFrame } from "../common/space_lua/runtime.ts";

export type LocationState = Ref & {
  scrollTop?: number;
  selection?: {
    anchor: number;
    head?: number;
  };
};

export class PathPageNavigator {
  navigationResolve?: () => void;

  openLocations = new Map<string, LocationState>();

  constructor(
    private client: Client,
  ) {}

  /**
   * Navigates the client to the given page, this involves:
   * - Patching the current popstate with current state
   * - Pushing the new state
   * - Dispatching a popstate event
   * @param pageRef to navigate to
   * @param replaceState whether to update the state in place (rather than to push a new state)
   */
  async navigate(
    ref: Ref,
    replaceState = false,
  ) {
    const currentState = this.buildCurrentLocationState();
    // No need to keep pos and anchor if we already have scrollTop and selection
    const cleanState: LocationState = currentState.kind === "page"
      ? {
        ...currentState,
        pos: undefined,
      }
      : currentState;

    // Store the state with the original page name, not the evaluated one
    this.openLocations.set(currentState.page || "", cleanState);

    if (!replaceState) {
      globalThis.history.replaceState(
        cleanState,
        "",
        `/${encodePageURI(currentState.page)}`,
      );
      globalThis.history.pushState(
        ref,
        "",
        `/${encodePageURI(ref.page)}`,
      );
    } else {
      globalThis.history.replaceState(
        ref,
        "",
        `/${encodePageURI(ref.page)}`,
      );
    }

    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: ref,
      }),
    );

    await new Promise<void>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }

  buildCurrentLocationState(): LocationState {
    const locationState: LocationState = parseRefFromURI();

    if (
      locationState.kind === "page"
    ) {
      const editorView = this.client.editorView;

      const mainSelection = editorView.state.selection.main;
      locationState.scrollTop = editorView.scrollDOM.scrollTop;
      locationState.selection = {
        head: mainSelection.head,
        anchor: mainSelection.anchor,
      };
    }

    return locationState;
  }

  subscribe(
    pageLoadCallback: (
      locationState: LocationState,
    ) => Promise<void>,
  ): void {
    const cb = (event: PopStateEvent) => {
      safeRun(async () => {
        const popState = event.state as LocationState;
        if (popState) {
          // This is the usual case
          if (!popState.page) {
            popState.kind = "page";
            // Evaluate the template if it contains interpolation
            const indexPage = this.client.clientConfig.indexPage;
            if (indexPage.includes("${")) {
              try {
                const env = luaBuildStandardEnv();
                const sf = new LuaStackFrame(env, null);
                sf.threadLocal.set("_GLOBAL", env);
                const result = await env.get("spacelua").get("interpolate").call(
                  sf,
                  indexPage,
                );
                popState.page = cleanPageRef(result);
              } catch (e) {
                console.error("Error evaluating index page template:", e);
                popState.page = cleanPageRef("index");
              }
            } else {
              popState.page = cleanPageRef(indexPage);
            }
          }
          if (
            popState.kind === "page" &&
            popState.pos === undefined &&
            popState.selection === undefined &&
            popState.scrollTop === undefined
          ) {
            // Pretty low-context popstate, so let's leverage openPages
            const openPage = this.openLocations.get(popState.page || "");
            if (openPage && openPage.kind === "page") {
              popState.selection = openPage.selection;
              popState.scrollTop = openPage.scrollTop;
            }
          }
          await pageLoadCallback(popState);
        } else {
          // This occurs when the page is loaded completely fresh with no browser history around it
          const pageRef = parseRefFromURI();
          if (!pageRef.page) {
            pageRef.kind = "page";
            // Evaluate the template if it contains interpolation
            const indexPage = this.client.clientConfig.indexPage;
            if (indexPage.includes("${")) {
              try {
                const env = luaBuildStandardEnv();
                const sf = new LuaStackFrame(env, null);
                sf.threadLocal.set("_GLOBAL", env);
                const result = await env.get("spacelua").get("interpolate").call(
                  sf,
                  indexPage,
                );
                pageRef.page = cleanPageRef(result);
              } catch (e) {
                console.error("Error evaluating index page template:", e);
                pageRef.page = cleanPageRef("index");
              }
            } else {
              pageRef.page = cleanPageRef(indexPage);
            }
          }
          await pageLoadCallback(pageRef);
        }
        if (this.navigationResolve) {
          this.navigationResolve();
        }
      });
    };
    globalThis.addEventListener("popstate", cb);

    cb(
      new PopStateEvent("popstate", {
        state: this.buildCurrentLocationState(),
      }),
    );
  }
}

export function parseRefFromURI(): Ref {
  const locationRef = parseRef(decodeURIComponent(
    location.pathname.substring(1),
  ));

  if (location.hash && locationRef.kind === "page") {
    locationRef.header = decodeURIComponent(location.hash.substring(1));
  }

  return locationRef;
}
