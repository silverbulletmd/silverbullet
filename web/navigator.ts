import {
  encodePageURI,
  parseRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import type { Client } from "./client.ts";
import { cleanPageRef } from "@silverbulletmd/silverbullet/lib/resolve";
import { renderTheTemplate } from "$common/syscalls/template.ts";
import { safeRun } from "../lib/async.ts";

export type LocationState = Ref & {
  scrollTop?: number;
  selection?: {
    anchor: number;
    head?: number;
  };
};

export class PathPageNavigator {
  navigationResolve?: () => void;
  indexPage!: string;

  openLocations = new Map<string, LocationState>();

  constructor(
    private client: Client,
  ) {
  }

  async init() {
    this.indexPage = cleanPageRef(
      await renderTheTemplate(
        this.client.clientConfig.indexPage,
        {},
        {},
        this.client.stateDataStore.functionMap,
      ),
    );
  }

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
    if (ref.kind === "page" && ref.page === this.indexPage) {
      ref.page = "";
    }
    const currentState = this.buildCurrentLocationState();
    // No need to keep pos and anchor if we already have scrollTop and selection
    const cleanState: LocationState = currentState.kind === "page"
      ? {
        ...currentState,
        pos: undefined,
        anchor: undefined,
      }
      : currentState;

    this.openLocations.set(currentState.page || this.indexPage, cleanState);

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
            popState.page = this.indexPage;
          }
          if (
            popState.kind === "page" &&
            popState.anchor === undefined && popState.pos === undefined &&
            popState.selection === undefined &&
            popState.scrollTop === undefined
          ) {
            // Pretty low-context popstate, so let's leverage openPages
            const openPage = this.openLocations.get(popState.page);
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
            pageRef.page = this.indexPage;
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
