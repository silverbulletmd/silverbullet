import { PageMeta } from "./types";
import { Socket } from "socket.io-client";
import { Update } from "@codemirror/collab";
import { Transaction, Text, ChangeSet } from "@codemirror/state";

import { Document } from "./collab";
import { cursorEffect } from "./cursorEffect";

export interface Space {
  listPages(): Promise<PageMeta[]>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  writePage(name: string, text: string): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;
  getPageMeta(name: string): Promise<PageMeta>;
}

export class HttpRemoteSpace extends EventTarget implements Space {
  url: string;
  socket: Socket;
  reqId = 0;

  constructor(url: string, socket: Socket) {
    super();
    this.url = url;
    this.socket = socket;

    socket.on("connect", () => {
      console.log("connected to socket");
      this.dispatchEvent(new Event("connect"));
    });

    socket.on("reload", (pageName: string) => {
      this.dispatchEvent(new CustomEvent("reload", { detail: pageName }));
    });
  }

  private wsCall(eventName: string, ...args: any[]): Promise<any> {
    return new Promise((resolve) => {
      this.reqId++;
      this.socket!.once(`${eventName}Resp${this.reqId}`, resolve);
      this.socket!.emit(eventName, this.reqId, ...args);
    });
  }

  async pushUpdates(
    pageName: string,
    version: number,
    fullUpdates: readonly (Update & { origin: Transaction })[]
  ): Promise<boolean> {
    if (this.socket) {
      let updates = fullUpdates.map((u) => ({
        clientID: u.clientID,
        changes: u.changes.toJSON(),
        cursors: u.effects?.map((e) => e.value),
      }));
      return this.wsCall("pushUpdates", pageName, version, updates);
    }
    return false;
  }

  async pullUpdates(
    pageName: string,
    version: number
  ): Promise<readonly Update[]> {
    let updates: Update[] = await this.wsCall("pullUpdates", pageName, version);
    let ups = updates.map((u) => ({
      changes: ChangeSet.fromJSON(u.changes),
      effects: u.effects?.map((e) => cursorEffect.of(e.value)),
      clientID: u.clientID,
    }));
    console.log("Got updates", ups);
    return ups;
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

  async openPage(name: string): Promise<Document> {
    this.reqId++;
    let [version, text] = await this.wsCall("openPage", name);
    return new Document(Text.of(text), version);
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
