import { safeRun } from "../common/util";

function encodePageUrl(name: string): string {
  return name.replaceAll(" ", "_");
}

function decodePageUrl(url: string): string {
  return url.replaceAll("_", " ");
}

export class PathPageNavigator {
  navigationResolve?: () => void;

  constructor(readonly root: string = "") {}

  async navigate(page: string, pos?: number, replaceState = false) {
    if (replaceState) {
      window.history.replaceState(
        { page, pos },
        page,
        `${this.root}/${encodePageUrl(page)}`
      );
    } else {
      window.history.pushState(
        { page, pos },
        page,
        `${this.root}/${encodePageUrl(page)}`
      );
    }
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { page, pos },
      })
    );
    await new Promise<void>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }

  subscribe(
    pageLoadCallback: (pageName: string, pos: number) => Promise<void>
  ): void {
    const cb = (event?: PopStateEvent) => {
      const gotoPage = this.getCurrentPage();
      if (!gotoPage) {
        return;
      }
      safeRun(async () => {
        await pageLoadCallback(
          this.getCurrentPage(),
          event?.state && event.state.pos
        );
        if (this.navigationResolve) {
          this.navigationResolve();
        }
      });
    };
    window.addEventListener("popstate", cb);
    cb();
  }

  decodeURI(): [string, number] {
    let parts = decodeURI(
      location.pathname.substring(this.root.length + 1)
    ).split("@");
    let page =
      parts.length > 1 ? parts.slice(0, parts.length - 1).join("@") : parts[0];
    let pos = parts.length > 1 ? parts[parts.length - 1] : "0";
    if (pos.match(/^\d+$/)) {
      return [page, +pos];
    } else {
      return [`${page}@${pos}`, 0];
    }
  }

  getCurrentPage(): string {
    return decodePageUrl(this.decodeURI()[0]);
  }

  getCurrentPos(): number {
    // console.log("Pos", this.decodeURI()[1]);
    return this.decodeURI()[1];
  }
}
