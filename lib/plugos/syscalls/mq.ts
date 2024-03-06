import { SysCallMapping } from "../system.ts";
import { MessageQueue } from "../../data/mq.ts";

export function mqSyscalls(
  mq: MessageQueue,
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
    "mq.getQueueStats": (_ctx, queue: string) => {
      return mq.getQueueStats(queue);
    },
  };
}
