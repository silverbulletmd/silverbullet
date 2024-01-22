import { safeRun } from "../common/util.ts";
import { PageRef, parsePageRef } from "$sb/lib/page.ts";
import { PageState } from "./open_pages.ts";
import { Client } from "./client.ts";
import { extractPageState } from "./open_pages.ts";

export class PathPageNavigator {
  navigationResolve?: () => void;

  constructor(
    private client: Client,
    readonly indexPage: string,
    readonly root: string = "",
  ) {}

  async navigate(
    nextPageRef: PageRef,
    replaceState = false,
  ) {
    if (nextPageRef.page === this.indexPage) {
      nextPageRef.page = "";
    }
    if (!replaceState) {
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
      console.log("Got this popstate event", event);

      safeRun(async () => {
        const currentState = extractPageState(this.client);
        console.log("Current state", currentState, "pop state event", event);
        if (currentState.page !== undefined) {
          console.log("Replacing old state");
          window.history.replaceState(currentState, "");
        }
        if (event?.state) {
          await pageLoadCallback(event.state);
        } else {
          console.log("Got null state so using", this.decodeURI());
          await pageLoadCallback(this.decodeURI());
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
