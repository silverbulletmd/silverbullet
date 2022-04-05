import { safeRun } from "./util";

function encodePageUrl(name: string): string {
  return name.replaceAll(" ", "_");
}

function decodePageUrl(url: string): string {
  return url.replaceAll("_", " ");
}

export class PathPageNavigator {
  navigationResolve?: () => void;

  async navigate(page: string, pos?: number) {
    window.history.pushState({ page, pos }, page, `/${encodePageUrl(page)}`);
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

  getCurrentPage(): string {
    let [page] = location.pathname.substring(1).split("@");
    return decodePageUrl(page);
  }

  getCurrentPos(): number {
    let [, pos] = location.pathname.substring(1).split("@");
    return +pos || 0;
  }
}
