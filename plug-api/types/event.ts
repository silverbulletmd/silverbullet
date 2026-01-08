import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { EventSubscriptionDef } from "./manifest.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

export type IndexTreeEvent = {
  name: string;
  tree: ParseTree;
  meta: PageMeta;
  text: string;
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

export type ResolvedPlug = {
  code: string;
  name?: string; // This will only dictate the filename
} | string;
