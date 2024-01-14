import { SysCallMapping } from "../system.ts";
import { MessageQueue } from "../lib/mq.ts";

export function mqSyscalls(
  mq: MessageQueue,
): SysCallMapping {
  return {
    "mq.send": (queue: string, body: any) => {
      return mq.send(queue, body);
    },
    "mq.batchSend": (queue: string, bodies: any[]) => {
      return mq.batchSend(queue, bodies);
    },
    "mq.ack": (queue: string, id: string) => {
      return mq.ack(queue, id);
    },
    "mq.batchAck": (queue: string, ids: string[]) => {
      return mq.batchAck(queue, ids);
    },
    "mq.getQueueStats": (queue: string) => {
      return mq.getQueueStats(queue);
    },
  };
}
