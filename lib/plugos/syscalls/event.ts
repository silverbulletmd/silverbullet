import { SysCallMapping } from "../system.ts";
import { EventHookI } from "../eventhook.ts";

export function eventSyscalls(eventHook: EventHookI): SysCallMapping {
  return {
    "event.dispatch": (_ctx, eventName: string, data: any) => {
      return eventHook.dispatchEvent(eventName, data);
    },
    "event.list": () => {
      return eventHook.listEvents();
    },
  };
}
