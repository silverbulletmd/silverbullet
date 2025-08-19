import {
  encodePageURI,
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { Client } from "./client.ts";

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
  navigationPromise: PromiseWithResolvers<void> | null = null;
  indexRef!: Ref;

  openLocations = new Map<string, LocationState>();

  constructor(
    private client: Client,
  ) {
    this.indexRef = this.client.getIndexRef();
  }

  /**
   * Navigates the client to the given page. An empty string path is navigated
   * to the index page. This function also updates the browser history
   * @param replaceState whether to update the state in place (rather than to
   * push a new state)
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
        `${document.baseURI}${
          encodePageURI(getNameFromPath(currentState.path))
        }`,
      );
      globalThis.history.pushState(
        ref,
        "",
        `${document.baseURI}${encodePageURI(getNameFromPath(ref.path))}`,
      );
    } else {
      globalThis.history.replaceState(
        ref,
        "",
        `${document.baseURI}${encodePageURI(getNameFromPath(ref.path))}`,
      );
    }

    this.navigationPromise = Promise.withResolvers();

    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: ref,
      }),
    );

    try {
      await this.navigationPromise.promise;
    } catch {
      // The navigation failed, let's revert everything we've done (This could
      // e.g. be a document editor which doesn't exist)
      if (!replaceState) {
        history.go(-1);
      } else {
        if (currentState.path === ref.path) {
          // This can e.g. happen on the first navigate. We obviously can't fall back to the same path, so fallback to the indexpage
          globalThis.history.replaceState(
            this.indexRef,
            "",
            `${document.baseURI}${
              encodePageURI(getNameFromPath(this.indexRef.path))
            }`,
          );
        } else {
          globalThis.history.replaceState(
            currentState,
            "",
            `${document.baseURI}${
              encodePageURI(getNameFromPath(currentState.path))
            }`,
          );
        }

        // This is a reload and realistically the easiest option to recover
        // TODO: Maybe manually recover by doing a dispatch popstate
        history.go(0);
      }
    }

    this.navigationPromise = null;
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
    globalThis.addEventListener("popstate", async (event: PopStateEvent) => {
      const state = event.state as LocationState;

      // Try filling in the ref using the openLocation cache
      if (
        !state.details && !state.selection && !state.scrollTop
      ) {
        const openLocation = this.openLocations.get(state.path);
        if (openLocation) {
          state.selection = openLocation.selection;
          state.scrollTop = openLocation.scrollTop;
        }
      }

      await pageLoadCallback(state)
        .then(
          this.navigationPromise?.resolve,
          this.navigationPromise?.reject,
        );
    });

    // Do the inital navigation
    const ref = this.buildCurrentLocationState();
    this.navigate(ref, true);
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
