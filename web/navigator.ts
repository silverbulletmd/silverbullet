import { safeRun } from "../common/util.ts";
import { PageRef, parsePageRef } from "$sb/lib/page.ts";
import { PageState } from "./open_pages.ts";

export class PathPageNavigator {
  navigationResolve?: () => void;

  constructor(readonly indexPage: string, readonly root: string = "") {}

  async navigate(
    nextPageRef: PageRef,
    currentState: PageState,
    replaceState = false,
  ) {
    if (nextPageRef.page === this.indexPage) {
      nextPageRef.page = "";
    }
    if (!replaceState) {
      console.log("Replacing old state", currentState);
      window.history.replaceState(
        currentState,
        "",
        `${this.root}/${currentState.page}`,
      );
      console.log("Pushing new state", nextPageRef);
      window.history.pushState(
        nextPageRef,
        "",
        `${this.root}/${nextPageRef.page}`,
      );
    } else {
      console.log("Replacing state", nextPageRef);
      window.history.replaceState(
        nextPageRef,
        "",
        `${this.root}/${nextPageRef.page}`,
      );
    }
    console.log("Explicitly dispatching popstate", nextPageRef);
    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: nextPageRef,
      }),
    );
    await new Promise<void>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }

  subscribe(
    pageLoadCallback: (
      pageState: PageState,
    ) => Promise<void>,
  ): void {
    const cb = (event?: PopStateEvent) => {
      console.log("Got this popstate", event?.state);
      safeRun(async () => {
        if (!event) {
          // Initial load
          await pageLoadCallback({
            ...this.decodeURI(),
            scrollTop: 0,
            selection: { anchor: 0 },
          });
        } else {
          const pageState: PageState = event.state!;
          await pageLoadCallback(pageState);
        }
        if (this.navigationResolve) {
          this.navigationResolve();
        }
      });
    };
    globalThis.addEventListener("popstate", cb);
    cb();
  }

  decodeURI(): PageRef {
    return parsePageRef(decodeURI(
      location.pathname.substring(this.root.length + 1),
    ));
  }

  get currentPage(): string {
    return this.decodeURI().page || this.indexPage;
  }

  get currentPos(): number | undefined {
    return this.decodeURI().pos;
  }

  get currentAnchor(): string | undefined {
    return this.decodeURI().anchor;
  }
}
