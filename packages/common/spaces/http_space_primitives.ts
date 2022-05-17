import { PageMeta } from "../types";
import { Plug } from "@plugos/plugos/plug";
import { SpacePrimitives } from "./space_primitives";

export class HttpSpacePrimitives implements SpacePrimitives {
  pageUrl: string;
  private plugUrl: string;
  token?: string;

  constructor(url: string, token?: string) {
    this.pageUrl = url + "/fs";
    this.plugUrl = url + "/plug";
    this.token = token;
  }

  private async authenticatedFetch(
    url: string,
    options: any
  ): Promise<Response> {
    if (this.token) {
      options.headers = options.headers || {};
      options.headers["Authorization"] = `Bearer ${this.token}`;
    }
    let result = await fetch(url, options);
    if (result.status === 401) {
      throw Error("Unauthorized");
    }
    return result;
  }

  public async fetchPageList(): Promise<{
    pages: Set<PageMeta>;
    nowTimestamp: number;
  }> {
    let req = await this.authenticatedFetch(this.pageUrl, {
      method: "GET",
    });

    let result = new Set<PageMeta>();
    ((await req.json()) as any[]).forEach((meta: any) => {
      const pageName = meta.name;
      result.add({
        name: pageName,
        lastModified: meta.lastModified,
        perm: "rw",
      });
    });

    return {
      pages: result,
      nowTimestamp: +req.headers.get("Now-Timestamp")!,
    };
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let res = await this.authenticatedFetch(`${this.pageUrl}/${name}`, {
      method: "GET",
    });
    if (res.headers.get("X-Status") === "404") {
      throw new Error(`Page not found`);
    }
    return {
      text: await res.text(),
      meta: this.responseToMeta(name, res),
    };
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    // TODO: lastModified ignored for now
    let res = await this.authenticatedFetch(`${this.pageUrl}/${name}`, {
      method: "PUT",
      body: text,
      headers: lastModified
        ? {
            "Last-Modified": "" + lastModified,
          }
        : undefined,
    });
    const newMeta = this.responseToMeta(name, res);
    return newMeta;
  }

  async deletePage(name: string): Promise<void> {
    let req = await this.authenticatedFetch(`${this.pageUrl}/${name}`, {
      method: "DELETE",
    });
    if (req.status !== 200) {
      throw Error(`Failed to delete page: ${req.statusText}`);
    }
  }

  async proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    let req = await this.authenticatedFetch(
      `${this.plugUrl}/${plug.name}/syscall/${name}`,
      {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(args),
      }
    );
    if (req.status !== 200) {
      let error = await req.text();
      throw Error(error);
    }
    if (req.headers.get("Content-length") === "0") {
      return;
    }
    return await req.json();
  }

  async invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    // Invoke locally
    if (!env || env === "client") {
      return plug.invoke(name, args);
    }
    // Or dispatch to server
    let req = await this.authenticatedFetch(
      `${this.plugUrl}/${plug.name}/function/${name}`,
      {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(args),
      }
    );
    if (req.status !== 200) {
      let error = await req.text();
      throw Error(error);
    }
    if (req.headers.get("Content-length") === "0") {
      return;
    }
    if (req.headers.get("Content-type") === "application/json") {
      return await req.json();
    } else {
      return await req.text();
    }
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    let res = await this.authenticatedFetch(`${this.pageUrl}/${name}`, {
      method: "OPTIONS",
    });
    if (res.headers.get("X-Status") === "404") {
      throw new Error(`Page not found`);
    }
    return this.responseToMeta(name, res);
  }

  private responseToMeta(name: string, res: Response): PageMeta {
    return {
      name,
      lastModified: +(res.headers.get("Last-Modified") || "0"),
      perm: (res.headers.get("X-Permission") as "rw" | "ro") || "rw",
    };
  }
}
