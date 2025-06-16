import type { EventSubscriptionDef } from "./manifest.ts";

export type EventSubscription = EventSubscriptionDef & {
  run: (...args: any[]) => Promise<any>;
};
