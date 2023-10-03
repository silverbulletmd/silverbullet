import { SysCallMapping } from "../system.ts";
import { fullQueueName } from "../lib/mq_util.ts";
import { MessageQueue } from "../lib/mq.ts";

export function mqSyscalls(
  mq: MessageQueue,
): SysCallMapping {
  return {
    "mq.send": (ctx, queue: string, body: any) => {
      return mq.send(fullQueueName(ctx.plug.name!, queue), body);
    },
    "mq.batchSend": (ctx, queue: string, bodies: any[]) => {
      return mq.batchSend(fullQueueName(ctx.plug.name!, queue), bodies);
    },
    "mq.ack": (ctx, queue: string, id: string) => {
      return mq.ack(fullQueueName(ctx.plug.name!, queue), id);
    },
    "mq.batchAck": (ctx, queue: string, ids: string[]) => {
      return mq.batchAck(fullQueueName(ctx.plug.name!, queue), ids);
    },
    "mq.getQueueStats": (ctx, queue: string) => {
      return mq.getQueueStats(fullQueueName(ctx.plug.name!, queue));
    },
  };
}
