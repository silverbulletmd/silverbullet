import { SysCallMapping } from "../system.ts";
import { EventHook } from "../hooks/event.ts";

export function eventSyscalls(eventHook: EventHook): SysCallMapping {
  return {
    "event.dispatch": (_ctx, eventName: string, data: any) => {
      return eventHook.dispatchEvent(eventName, data);
    },
    "event.list": () => {
      return eventHook.listEvents();
    },
  };
}
