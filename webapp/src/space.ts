import { PageMeta } from "./types";
import { Socket } from "socket.io-client";
import { Update } from "@codemirror/collab";
import { Transaction, Text, ChangeSet } from "@codemirror/state";

import { Document } from "./collab";

export interface Space {
  listPages(): Promise<PageMeta[]>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  writePage(name: string, text: string): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;
  getPageMeta(name: string): Promise<PageMeta>;
}

export class HttpRemoteSpace implements Space {
  url: string;
  socket: Socket;
  reqId = 0;

  constructor(url: string, socket: Socket) {
    this.url = url;
    this.socket = socket;

    socket.on("connect", () => {
      console.log("connected via SocketIO");
    });
  }

  pushUpdates(
    pageName: string,
    version: number,
    fullUpdates: readonly (Update & { origin: Transaction })[]
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.socket) {
        let updates = fullUpdates.map((u) => ({
          clientID: u.clientID,
          changes: u.changes.toJSON(),
        }));
        this.reqId++;
        this.socket.emit("pushUpdates", this.reqId, pageName, version, updates);
        this.socket.once("pushUpdatesResp" + this.reqId, (result) => {
          resolve(result);
        });
      }
    });
  }

  async pullUpdates(
    pageName: string,
    version: number
  ): Promise<readonly Update[]> {
    let updates: Update[] = await this.wsCall("pullUpdates", pageName, version);
    console.log("Got updates", updates);
    return updates.map((u) => ({
      changes: ChangeSet.fromJSON(u.changes),
      clientID: u.clientID,
    }));
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

  wsCall(eventName: string, ...args: any[]): Promise<any> {
    return new Promise((resolve) => {
      this.reqId++;
      this.socket!.once(`${eventName}Resp${this.reqId}`, resolve);
      this.socket!.emit(eventName, this.reqId, ...args);
    });
  }

  async openPage(name: string): Promise<Document> {
    this.reqId++;
    let [meta, text] = await this.wsCall("openPage", name);
    console.log("Got this", meta, text);
    meta.lastModified = new Date(meta.lastModified);
    return new Document(Text.of(text), meta);
  }

  async closePage(name: string): Promise<void> {
    this.socket!.emit("closePage", name);
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
