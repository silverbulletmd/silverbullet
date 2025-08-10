import {
  encodePageURI,
  isMarkdownPath,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "./client.ts";
import { safeRun } from "../lib/async.ts";

// The path of a location state should not be empty, rather it should be
// normalized to the indexpage beforhand
export type LocationState = Ref & {
  scrollTop?: number;
  selection?: {
    anchor: number;
    head?: number;
  };
};

export class PathPageNavigator {
  navigationResolve?: () => void;
  indexRef!: Ref;

  openLocations = new Map<string, LocationState>();

  constructor(
    private client: Client,
  ) {
    this.indexRef = this.client.getIndexRef();
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
    const currentState = this.buildCurrentLocationState();
    // Remove details as we prefer to actually keep the scrollTop
    currentState.details = undefined;

    if (ref.path === "") {
      ref.path = this.indexRef.path;
    }

    this.openLocations.set(currentState.path, currentState);

    if (!replaceState) {
      globalThis.history.replaceState(
        currentState,
        "",
        `${document.baseURI}${encodePageURI(currentState.path)}`,
      );
      globalThis.history.pushState(
        ref,
        "",
        `${document.baseURI}${encodePageURI(ref.path)}`,
      );
    } else {
      globalThis.history.replaceState(
        ref,
        "",
        `${document.baseURI}${encodePageURI(ref.path)}`,
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
    const locationState: LocationState = parseRefFromURI() || this.indexRef;

    if (isMarkdownPath(locationState.path)) {
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
          if (
            popState.details === undefined &&
            popState.selection === undefined &&
            popState.scrollTop === undefined
          ) {
            // Pretty low-context popstate, so let's leverage openPages
            const openLocation = this.openLocations.get(popState.path);
            if (openLocation) {
              popState.selection = openLocation.selection;
              popState.scrollTop = openLocation.scrollTop;
            }
          }
          await pageLoadCallback(popState);
        } else {
          // This occurs when the page is loaded completely fresh with no browser history around it
          const pageRef = parseRefFromURI() || this.indexRef;
          await pageLoadCallback(pageRef);
        }
        if (this.navigationResolve) {
          this.navigationResolve();
        }
      });
    };
    globalThis.addEventListener("popstate", cb);

    const ref = this.buildCurrentLocationState();
    if (ref.path === "") {
      ref.path = this.indexRef.path;
    }

    cb(
      new PopStateEvent("popstate", {
        state: ref,
      }),
    );
  }
}

export function parseRefFromURI(): Ref | null {
  const locationRef = parseToRef(decodeURIComponent(
    location.href.substring(document.baseURI.length), //this essentially returns location with prefix and leading slash removed (equivalent to location.pathname.substring(prefix.length).substring(1)),
  ));

  if (locationRef && location.hash) {
    locationRef.details = {
      type: "header",
      header: decodeURIComponent(location.hash.substring(1)),
    };
  }

  return locationRef;
}
