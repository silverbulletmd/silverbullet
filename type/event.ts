import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { EventSubscriptionDef } from "../lib/manifest.ts";

export type IndexEvent = {
  name: string;
  text: string;
};

export type IndexTreeEvent = {
  name: string;
  tree: ParseTree;
};

export type PageCreatingEvent = {
  name: string;
};

export type PageCreatingContent = {
  text: string;
  perm: "ro" | "rw";
};
export type EventSubscription = EventSubscriptionDef & {
  run: (...args: any[]) => Promise<any>;
};
