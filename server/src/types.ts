import { Update } from "@codemirror/collab";
import { Text } from "@codemirror/state";
import { Socket } from "socket.io";
import { Cursor } from "../../webapp/src/cursorEffect";
import { PageMeta } from "./server";

export class Client {
  constructor(public socket: Socket, public version: number) {}
}

export class Page {
  versionOffset = 0;
  updates: Update[] = [];
  cursors = new Map<string, Cursor>();
  clients = new Set<Client>();

  pending: ((value: any) => void)[] = [];

  text: Text;
  meta: PageMeta;

  saveTimer: NodeJS.Timeout | undefined;
  name: string;

  constructor(name: string, text: string, meta: PageMeta) {
    this.name = name;
    this.text = Text.of(text.split("\n"));
    this.meta = meta;
  }

  updatesSince(version: number): Update[] {
    return this.updates.slice(version - this.versionOffset);
  }

  get version(): number {
    return this.updates.length + this.versionOffset;
  }

  flushUpdates(version: number) {
    if (this.versionOffset > version) {
      throw Error("This should never happen");
    }
    if (this.versionOffset === version) {
      return;
    }
    this.updates = this.updates.slice(version - this.versionOffset);
    this.versionOffset = version;
    // console.log("Flushed updates, now got", this.updates.length, "updates");
  }

  toJSON() {
    return {
      text: this.text,
      version: this.version,
      cursors: Object.fromEntries(this.cursors.entries()),
    };
  }
}
