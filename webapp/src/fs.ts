import { NuggetMeta } from "./types";

export interface FileSystem {
  listNuggets(): Promise<NuggetMeta[]>;
  readNugget(name: string): Promise<{ text: string; meta: NuggetMeta }>;
  writeNugget(name: string, text: string): Promise<NuggetMeta>;
  getMeta(name: string): Promise<NuggetMeta>;
}

export class HttpFileSystem implements FileSystem {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  async listNuggets(): Promise<NuggetMeta[]> {
    let req = await fetch(this.url, {
      method: "GET",
    });

    return (await req.json()).map((meta: any) => ({
      name: meta.name,
      lastModified: new Date(meta.lastModified),
    }));
  }
  async readNugget(name: string): Promise<{ text: string; meta: NuggetMeta }> {
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
  async writeNugget(name: string, text: string): Promise<NuggetMeta> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "PUT",
      body: text,
    });
    // 201 (Created) means a new nugget was created
    return {
      lastModified: new Date(+req.headers.get("Last-Modified")!),
      name: name,
      created: req.status === 201,
    };
  }

  async getMeta(name: string): Promise<NuggetMeta> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "OPTIONS",
    });
    return {
      name: name,
      lastModified: new Date(+req.headers.get("Last-Modified")!),
    };
  }
}
