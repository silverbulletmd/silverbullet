import type { SysCallMapping } from "../system.ts";
import type { EventHookI } from "../eventhook.ts";

export function eventSyscalls(eventHook: EventHookI): SysCallMapping {
  return {
    "event.dispatch": (_ctx, eventName: string, data: any) => {
      return eventHook.dispatchEvent(eventName, data);
    },
    "event.listEvents": () => {
      return eventHook.listEvents();
    },
  };
}
