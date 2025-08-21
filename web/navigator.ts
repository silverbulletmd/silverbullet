import {
  encodePageURI,
  getNameFromPath,
  isMarkdownPath,
  parseToRef,
  type Path,
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
  navigationPromise: PromiseWithResolvers<string | null> | null = null;
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
        `${document.baseURI}${this.pathToURI(currentState.path)}`,
      );
      globalThis.history.pushState(
        ref,
        "",
        `${document.baseURI}${this.pathToURI(ref.path)}`,
      );
    } else {
      globalThis.history.replaceState(
        ref,
        "",
        `${document.baseURI}${this.pathToURI(ref.path)}`,
      );
    }

    this.navigationPromise = Promise.withResolvers();

    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: ref,
      }),
    );

    const error = await this.navigationPromise.promise;

    if (error !== null) {
      // The navigation failed, let's revert everything we've done (This could
      // e.g. be a document editor which doesn't exist)
      this.client.flashNotification(`Failed to navigate: ${error}`, "error");

      if (!replaceState) {
        history.go(-1);
      } else {
        // This can e.g. happen on the first navigate. We obviously can't fall back to the same path, so fallback to the indexpage

        const newState: LocationState = currentState.path === ref.path
          ? this.indexRef
          : currentState;

        globalThis.history.replaceState(
          newState,
          "",
          `${document.baseURI}${this.pathToURI(newState.path)}`,
        );

        globalThis.dispatchEvent(
          new PopStateEvent("popstate", {
            state: newState,
          }),
        );

        // This is should never fail, because we already navigated here before.
        await this.navigationPromise.promise;
      }
    }

    this.navigationPromise = null;
  }

  private pathToURI(path: Path): string {
    return path !== this.indexRef.path
      ? encodePageURI(getNameFromPath(path))
      : "";
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

  async subscribe(
    pageLoadCallback: (
      locationState: LocationState,
    ) => Promise<void>,
  ): Promise<void> {
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

      // For some (propably smart) reason the reject() function on a
      // Promise.withResolvers, also throws. This is hugely annoying here, so
      // let's resolve for both cases
      await pageLoadCallback(state)
        .then(
          () => this.navigationPromise?.resolve(null),
          (e) => this.navigationPromise?.resolve(e.message),
        );
    });

    // Do the inital navigation
    const ref = this.buildCurrentLocationState();
    await this.navigate(ref, true);
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
