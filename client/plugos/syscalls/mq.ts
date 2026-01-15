import type { DataStoreMQ } from "../../data/mq.datastore.ts";
import type { MQListenerSpec } from "../hooks/mq.ts";
import type { SysCallMapping } from "../system.ts";

export type EventSubscription = MQListenerSpec & {
  run: (...args: any[]) => Promise<any>;
};

export function mqSyscalls(
  mq: DataStoreMQ,
): SysCallMapping {
  return {
    /**
     * Define a Lua event listener
     */
    "mq.subscribe": (
      _ctx,
      def: MQListenerSpec,
    ) => {
      def.autoAck = def.autoAck != false;
      // console.log("Registering Lua event listener: ", def.name);
      client.config.insert([
        "mqSubscriptions",
        def.queue,
      ], def);
    },
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
    "mq.flushAllQueues": () => {
      return mq.flushAllQueues();
    },
    "mq.getQueueStats": (_ctx, queue: string) => {
      return mq.getQueueStats(queue);
    },
    "mq.awaitEmptyQueue": (_ctx, queue: string) => {
      return mq.awaitEmptyQueue(queue);
    },
  };
}
