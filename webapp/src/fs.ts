import { NoteMeta } from "./types";

export interface FileSystem {
  listNotes(): Promise<NoteMeta[]>;
  readNote(name: string): Promise<string>;
  // @return whether a new note was created for this
  writeNote(name: string, text: string): Promise<boolean>;
}

export class HttpFileSystem implements FileSystem {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  async listNotes(): Promise<NoteMeta[]> {
    let req = await fetch(this.url, {
      method: "GET",
    });

    return (await req.json()).map((name: string) => ({ name }));
  }
  async readNote(name: string): Promise<string> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "GET",
    });
    return await req.text();
  }
  async writeNote(name: string, text: string): Promise<boolean> {
    let req = await fetch(`${this.url}/${name}`, {
      method: "PUT",
      body: text,
    });
    // 201 (Created) means a new note was created
    return req.status === 201;
  }
}
