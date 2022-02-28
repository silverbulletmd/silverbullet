import { safeRun } from "./util";

export interface IPageNavigator {
  subscribe(pageLoadCallback: (pageName: string) => Promise<void>): void;
  navigate(page: string): void;
  getCurrentPage(): string;
}

function encodePageUrl(name: string): string {
  return name.replaceAll(" ", "_");
}

function decodePageUrl(url: string): string {
  return url.replaceAll("_", " ");
}

export class PathPageNavigator implements IPageNavigator {
  navigationResolve?: (value: undefined) => void;
  async navigate(page: string) {
    console.log("Pushing state", page);
    window.history.pushState({ page: page }, page, `/${encodePageUrl(page)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise<undefined>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }
  subscribe(pageLoadCallback: (pageName: string) => Promise<void>): void {
    const cb = () => {
      console.log("State popped", this.getCurrentPage());
      safeRun(async () => {
        await pageLoadCallback(this.getCurrentPage());
        if (this.navigationResolve) {
          this.navigationResolve(undefined);
        }
      });
    };
    window.addEventListener("popstate", cb);
    cb();
  }

  getCurrentPage(): string {
    return decodePageUrl(location.pathname.substring(1));
  }
}

export class HashPageNavigator implements IPageNavigator {
  navigationResolve?: (value: undefined) => void;
  async navigate(page: string) {
    location.hash = encodePageUrl(page);
    await new Promise<undefined>((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = undefined;
  }
  subscribe(pageLoadCallback: (pageName: string) => Promise<void>): void {
    const cb = () => {
      safeRun(async () => {
        await pageLoadCallback(this.getCurrentPage());
        if (this.navigationResolve) {
          this.navigationResolve(undefined);
        }
      });
    };
    window.addEventListener("hashchange", cb);
    cb();
  }
  getCurrentPage(): string {
    return decodePageUrl(location.hash.substring(1));
  }
}
