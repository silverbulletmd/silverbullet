import type { EventHookT } from "$lib/manifest.ts";
import type { Hook } from "./types.ts";

export interface EventHookI extends Hook<EventHookT> {
  dispatchEvent(eventName: string, ...args: unknown[]): Promise<unknown[]>;
  listEvents(): string[];
}
