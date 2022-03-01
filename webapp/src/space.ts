import { PageMeta } from "./types";

export interface Space {
  listPages(): Promise<PageMeta[]>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  writePage(name: string, text: string): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;
  getPageMeta(name: string): Promise<PageMeta>;
}

export class HttpRemoteSpace implements Space {
  url: string;

  constructor(url: string) {
    this.url = url;
  }

  async listPages(): Promise<PageMeta[]> {
    let req = await fetch(this.url, {
      method: "GET",
    });

    return (await req.json()).map((meta: any) => ({
      name: meta.name,
      lastModified: new Date(meta.lastModified),
    }));
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "GET",
    });
    return {
      text: await req.text(),
      meta: {
        lastModified: new Date(+req.headers.get("Last-Modified")!),
        name: name,
      },
    };
  }

  async writePage(name: string, text: string): Promise<PageMeta> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "PUT",
      body: text,
    });
    // 201 (Created) means a new page was created
    return {
      lastModified: new Date(+req.headers.get("Last-Modified")!),
      name: name,
      created: req.status === 201,
    };
  }

  async deletePage(name: string): Promise<void> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "DELETE",
    });
    if (req.status !== 200) {
      throw Error(`Failed to delete page: ${req.statusText}`);
    }
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "OPTIONS",
    });
    return {
      name: name,
      lastModified: new Date(+req.headers.get("Last-Modified")!),
    };
  }
}
