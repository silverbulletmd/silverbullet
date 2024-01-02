import { safeRun } from "../common/util.ts";

function encodePageUrl(name: string): string {
  return name;
}

function decodePageUrl(url: string): string {
  return url;
}

export class PathPageNavigator {
  navigationResolve?: () => void;

  constructor(readonly indexPage: string, readonly root: string = "") {}

  async navigate(
    page: string,
    pos?: number | string | undefined,
    replaceState = false,
  ) {
    let encodedPage = encodePageUrl(page);
    if (page === this.indexPage) {
      encodedPage = "";
    }
    if (replaceState) {
      window.history.replaceState(
        { page },
        page,
        `${this.root}/${encodedPage}`,
      );
    } else {
      window.history.pushState(
        { page },
        page,
        `${this.root}/${encodedPage}`,
      );
    }
    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { page, pos },
      }),
    );
    await new Promise<void>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }

  subscribe(
    pageLoadCallback: (
      pageName: string,
      pos: number | string | undefined,
    ) => Promise<void>,
  ): void {
    const cb = (event?: PopStateEvent) => {
      const gotoPage = this.getCurrentPage();
      if (!gotoPage) {
        return;
      }
      safeRun(async () => {
        await pageLoadCallback(
          this.getCurrentPage(),
          event?.state?.pos,
        );
        if (this.navigationResolve) {
          this.navigationResolve();
        }
      });
    };
    globalThis.addEventListener("popstate", cb);
    cb();
  }

  decodeURI(): [string, number | string] {
    const [page, pos] = decodeURI(
      location.pathname.substring(this.root.length + 1),
    ).split(/[@$]/);
    if (pos) {
      if (pos.match(/^\d+$/)) {
        return [page, +pos];
      } else {
        return [page, pos];
      }
    } else {
      return [page, 0];
    }
  }

  getCurrentPage(): string {
    return decodePageUrl(this.decodeURI()[0]) || this.indexPage;
  }

  getCurrentPos(): number | string {
    // console.log("Pos", this.decodeURI()[1]);
    return this.decodeURI()[1];
  }
}
