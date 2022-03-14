import { PageMeta } from "./types";
import { Socket } from "socket.io-client";
import { Update } from "@codemirror/collab";
import { Transaction, Text, ChangeSet } from "@codemirror/state";

import { CollabEvents, CollabDocument } from "./collab";
import { Cursor, cursorEffect } from "./cursorEffect";
import { EventEmitter } from "./event";

export interface Space {
  listPages(): Promise<PageMeta[]>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  writePage(name: string, text: string): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;
  getPageMeta(name: string): Promise<PageMeta>;
}

export type SpaceEvents = {
  connect: () => void;
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
} & CollabEvents;

export class RealtimeSpace extends EventEmitter<SpaceEvents> implements Space {
  socket: Socket;
  reqId = 0;
  allPages = new Set<PageMeta>();

  constructor(socket: Socket) {
    super();
    this.socket = socket;

    [
      "connect",
      "cursorSnapshot",
      "pageCreated",
      "pageChanged",
      "pageDeleted",
    ].forEach((eventName) => {
      socket.on(eventName, (...args) => {
        this.emit(eventName as keyof SpaceEvents, ...args);
      });
    });
    this.wsCall("listPages").then((pages) => {
      this.allPages = new Set(pages);
      this.emit("pageListUpdated", this.allPages);
    });
    this.on({
      pageCreated: (meta) => {
        this.allPages.add(meta);
        console.log("New page created", meta);
        this.emit("pageListUpdated", this.allPages);
      },
      pageDeleted: (name) => {
        console.log("Page delete", name);
        this.allPages.forEach((meta) => {
          if (name === meta.name) {
            this.allPages.delete(meta);
          }
        });
        this.emit("pageListUpdated", this.allPages);
      },
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
    return ups;
  }

  async listPages(): Promise<PageMeta[]> {
    return Array.from(this.allPages);
  }

  async openPage(name: string): Promise<CollabDocument> {
    this.reqId++;
    let pageJSON = await this.wsCall("openPage", name);

    return new CollabDocument(
      Text.of(pageJSON.text),
      pageJSON.version,
      new Map(Object.entries(pageJSON.cursors))
    );
  }

  async closePage(name: string): Promise<void> {
    this.socket.emit("closePage", name);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    return this.wsCall("readPage", name);
  }

  async writePage(name: string, text: string): Promise<PageMeta> {
    return this.wsCall("writePage", name, text);
  }

  async deletePage(name: string): Promise<void> {
    return this.wsCall("deletePage", name);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    return this.wsCall("deletePage", name);
  }
}
