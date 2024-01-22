import { safeRun } from "../common/util.ts";
import { PageRef, parsePageRef } from "$sb/lib/page.ts";
import { encodePageRef } from "$sb/lib/page.ts";

export class PathPageNavigator {
  navigationResolve?: () => void;

  constructor(readonly indexPage: string, readonly root: string = "") {}

  async navigate(pageRef: PageRef, replaceState = false) {
    if (pageRef.page === this.indexPage) {
      pageRef.page = "";
    }
    if (replaceState) {
      window.history.replaceState(
        pageRef,
        "",
        `${this.root}/${pageRef.page}`,
      );
    } else {
      window.history.pushState(
        pageRef,
        "",
        `${this.root}/${pageRef.page}`,
      );
    }
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

  subscribe(
    pageLoadCallback: (
      pageRef: PageRef,
    ) => Promise<void>,
  ): void {
    const cb = (event?: PopStateEvent) => {
      safeRun(async () => {
        if (!event) {
          // Initial load
          await pageLoadCallback(this.decodeURI());
        } else {
          await pageLoadCallback(event.state!);
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
