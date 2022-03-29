import { SysCallMapping } from "../system";
import { EventHook } from "../hooks/event";

export function eventSyscalls(eventHook: EventHook): SysCallMapping {
  return {
    async dispatch(ctx, eventName: string, data: any) {
      return eventHook.dispatchEvent(eventName, data);
    },
  };
}
