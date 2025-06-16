import type { DataStoreMQ } from "../../data/mq.datastore.ts";
import type { SysCallMapping } from "../system.ts";

export function mqSyscalls(
  mq: DataStoreMQ,
): SysCallMapping {
  return {
    "mq.send": (_ctx, queue: string, body: any) => {
      return mq.send(queue, body);
    },
    "mq.batchSend": (_ctx, queue: string, bodies: any[]) => {
      return mq.batchSend(queue, bodies);
    },
    "mq.ack": (_ctx, queue: string, id: string) => {
      return mq.ack(queue, id);
    },
    "mq.batchAck": (_ctx, queue: string, ids: string[]) => {
      return mq.batchAck(queue, ids);
    },
    "mq.flushQueue": (_ctx, queue: string) => {
      return mq.flushQueue(queue);
    },
    "mq.getQueueStats": (_ctx, queue: string) => {
      return mq.getQueueStats(queue);
    },
  };
}
