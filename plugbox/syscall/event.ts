import { SysCallMapping } from "../system";
import { EventFeature } from "../feature/event";

export function eventSyscalls(eventFeature: EventFeature): SysCallMapping {
  return {
    async dispatch(ctx, eventName: string, data: any) {
      return eventFeature.dispatchEvent(eventName, data);
    },
  };
}
