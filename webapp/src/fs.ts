import { NuggetMeta } from "./types";

export interface FileSystem {
  listNuggets(): Promise<NuggetMeta[]>;
  readNugget(name: string): Promise<string>;
  // @return whether a new nugget was created for this
  writeNugget(name: string, text: string): Promise<boolean>;
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

    return (await req.json()).map((name: string) => ({ name }));
  }
  async readNugget(name: string): Promise<string> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "GET",
    });
    return await req.text();
  }
  async writeNugget(name: string, text: string): Promise<boolean> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "PUT",
      body: text,
    });
    // 201 (Created) means a new nugget was created
    return req.status === 201;
  }
}
