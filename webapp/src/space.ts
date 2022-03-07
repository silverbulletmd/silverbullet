import { PageMeta } from "./types";
import { Socket } from "socket.io-client";
import { serverEvents } from "../../server/src/events";
import { EventEmitter } from "events";

export interface Space {
  listPages(): Promise<PageMeta[]>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  writePage(name: string, text: string): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;
  getPageMeta(name: string): Promise<PageMeta>;
}

export class HttpRemoteSpace implements Space {
  url: string;
  socket?: Socket;

  constructor(url: string, socket: Socket | null) {
    this.url = url;
    // this.socket = socket;

    // socket.on("connect", () => {
    //   console.log("connected via SocketIO", serverEvents.pageText);
    // });
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

  async openPage(name: string) {
    this.socket!.on(serverEvents.pageText, (pageName, text) => {
      console.log("Got this", pageName, text);
    });
    this.socket!.emit(serverEvents.openPage, "start");
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
