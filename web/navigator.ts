import { safeRun } from "../common/util.ts";
import { PageRef, parsePageRef } from "$sb/lib/page.ts";
import { Client } from "./client.ts";
import { cleanPageRef } from "$sb/lib/resolve.ts";
import { renderHandlebarsTemplate } from "../common/syscalls/handlebars.ts";

export type PageState = PageRef & {
  scrollTop?: number;
  selection?: {
    anchor: number;
    head?: number;
  };
};

export class PathPageNavigator {
  navigationResolve?: () => void;
  indexPage: string;

  openPages = new Map<string, PageState>();

  constructor(
    private client: Client,
  ) {
    this.indexPage = cleanPageRef(
      renderHandlebarsTemplate(client.settings.indexPage, {}, {}),
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
    pageRef: PageRef,
    replaceState = false,
  ) {
    if (pageRef.page === this.indexPage) {
      pageRef.page = "";
    }
    const currentState = this.buildCurrentPageState();
    // No need to keep pos and anchor if we already have scrollTop and selection
    const cleanState = { ...currentState, pos: undefined, anchor: undefined };
    this.openPages.set(currentState.page || this.indexPage, cleanState);
    if (!replaceState) {
      console.log("Updating current state", currentState);
      window.history.replaceState(
        cleanState,
        "",
        `/${currentState.page}`,
      );
      console.log("Pushing new state", pageRef);
      window.history.pushState(
        pageRef,
        "",
        `/${pageRef.page}`,
      );
    } else {
      // console.log("Replacing state", pageRef);
      window.history.replaceState(
        pageRef,
        "",
        `/${pageRef.page}`,
      );
    }
    // console.log("Explicitly dispatching the popstate", pageRef);
    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: pageRef,
      }),
    );
    await new Promise<void>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }

  buildCurrentPageState(): PageState {
    const pageState: PageState = parsePageRefFromURI();
    const mainSelection = this.client.editorView.state.selection.main;
    pageState.scrollTop = this.client.editorView.scrollDOM.scrollTop;
    pageState.selection = {
      head: mainSelection.head,
      anchor: mainSelection.anchor,
    };
    return pageState;
  }

  subscribe(
    pageLoadCallback: (
      pageState: PageState,
    ) => Promise<void>,
  ): void {
    const cb = (event: PopStateEvent) => {
      safeRun(async () => {
        const popState = event.state;
        if (popState) {
          // This is the usual case
          if (!popState.page) {
            popState.page = this.indexPage;
          }
          if (
            popState.anchor === undefined && popState.pos === undefined &&
            popState.selection === undefined &&
            popState.scrollTop === undefined
          ) {
            // Pretty low-context popstate, so let's leverage openPages
            const openPage = this.openPages.get(popState.page);
            if (openPage) {
              console.log("Pulling open page state", openPage);
              popState.selection = openPage.selection;
              popState.scrollTop = openPage.scrollTop;
            }
          }
          console.log("Got popstate state, using", popState);
          await pageLoadCallback(popState);
        } else {
          // This occurs when the page is loaded completely fresh with no browser history around it
          // console.log("Got null state so using", this.parseURI());
          const pageRef = parsePageRefFromURI();
          if (!pageRef.page) {
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
        state: this.buildCurrentPageState(),
      }),
    );
  }
}

export function parsePageRefFromURI(): PageRef {
  const pageRef = parsePageRef(decodeURI(
    location.pathname.substring(1),
  ));

  if (location.hash) {
    pageRef.header = decodeURI(location.hash.substring(1));
  }

  return pageRef;
}
