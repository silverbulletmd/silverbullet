import {SysCallMapping} from "../system";
import {EventHook} from "../hooks/event";

export function eventSyscalls(eventHook: EventHook): SysCallMapping {
  return {
    "event.dispatch": async (ctx, eventName: string, data: any) => {
      return eventHook.dispatchEvent(eventName, data);
    },
  };
}
