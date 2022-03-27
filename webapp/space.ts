import { PageMeta } from "./types";
import { Socket } from "socket.io-client";
import { Update } from "@codemirror/collab";
import { ChangeSet, Text, Transaction } from "@codemirror/state";

import { CollabDocument, CollabEvents } from "./collab";
import { cursorEffect } from "./cursorEffect";
import { EventEmitter } from "../common/event";
import { Manifest } from "../common/manifest";
import { SystemJSON } from "../plugos/system";

export type SpaceEvents = {
  connect: () => void;
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
  loadSystem: (systemJSON: SystemJSON<any>) => void;
  plugLoaded: (plugName: string, plug: Manifest) => void;
  plugUnloaded: (plugName: string) => void;
} & CollabEvents;

export type KV = {
  key: string;
  value: any;
};

export class Space extends EventEmitter<SpaceEvents> {
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
      "loadSystem",
      "plugLoaded",
      "plugUnloaded",
    ].forEach((eventName) => {
      socket.on(eventName, (...args) => {
        this.emit(eventName as keyof SpaceEvents, ...args);
      });
    });
    this.wsCall("page.listPages").then((pages) => {
      this.allPages = new Set(pages);
      this.emit("pageListUpdated", this.allPages);
    });
    this.on({
      pageCreated: (meta) => {
        // Cannot reply on equivalence in set, need to iterate over all pages
        let found = false;
        for (const page of this.allPages) {
          if (page.name === meta.name) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.allPages.add(meta);
          console.log("New page created", meta);
          this.emit("pageListUpdated", this.allPages);
        }
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

  public wsCall(eventName: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.reqId++;
      this.socket!.once(`${eventName}Resp${this.reqId}`, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
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
      return this.wsCall("page.pushUpdates", pageName, version, updates);
    }
    return false;
  }

  async pullUpdates(
    pageName: string,
    version: number
  ): Promise<readonly Update[]> {
    let updates: Update[] = await this.wsCall(
      "page.pullUpdates",
      pageName,
      version
    );
    return updates.map((u) => ({
      changes: ChangeSet.fromJSON(u.changes),
      effects: u.effects?.map((e) => cursorEffect.of(e.value)),
      clientID: u.clientID,
    }));
  }

  async listPages(): Promise<PageMeta[]> {
    return Array.from(this.allPages);
  }

  async openPage(name: string): Promise<CollabDocument> {
    this.reqId++;
    let pageJSON = await this.wsCall("page.openPage", name);

    return new CollabDocument(
      Text.of(pageJSON.text),
      pageJSON.version,
      new Map(Object.entries(pageJSON.cursors))
    );
  }

  async closePage(name: string): Promise<void> {
    this.socket.emit("page.closePage", name);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    return this.wsCall("page.readPage", name);
  }

  async writePage(name: string, text: string): Promise<PageMeta> {
    return this.wsCall("page.writePage", name, text);
  }

  async deletePage(name: string): Promise<void> {
    return this.wsCall("page.deletePage", name);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    return this.wsCall("page.getPageMeta", name);
  }
}
