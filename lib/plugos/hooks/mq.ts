import type { Hook, Manifest } from "../types.ts";
import type { System } from "../system.ts";
import { throttle } from "../../async.ts";
import type { MQHookT } from "../../manifest.ts";
import type { DataStoreMQ } from "../../data/mq.datastore.ts";
import type { MQMessage } from "../../../type/datastore.ts";

export class MQHook implements Hook<MQHookT> {
  subscriptions: (() => void)[] = [];
  throttledReloadQueues = throttle(() => {
    this.reloadQueues();
  }, 1000);

  constructor(private system: System<MQHookT>, readonly mq: DataStoreMQ) {
  }

  apply(system: System<MQHookT>): void {
    this.system = system;
    system.on({
      plugLoaded: () => {
        this.throttledReloadQueues();
      },
      plugUnloaded: () => {
        this.throttledReloadQueues();
      },
    });

    this.throttledReloadQueues();
  }

  stop() {
    this.subscriptions.forEach((sub) => sub());
    this.subscriptions = [];
  }

  reloadQueues() {
    this.stop();
    for (const plug of this.system.loadedPlugs.values()) {
      if (!plug.manifest) {
        continue;
      }
      for (
        const [name, functionDef] of Object.entries(
          plug.manifest.functions,
        )
      ) {
        if (!functionDef.mqSubscriptions) {
          continue;
        }
        const subscriptions = functionDef.mqSubscriptions;
        for (const subscriptionDef of subscriptions) {
          const queue = subscriptionDef.queue;
          this.subscriptions.push(
            this.mq.subscribe(
              queue,
              {
                batchSize: subscriptionDef.batchSize,
                pollInterval: subscriptionDef.pollInterval,
              },
              async (messages: MQMessage[]) => {
                try {
                  await plug.invoke(name, [messages]);
                  if (subscriptionDef.autoAck) {
                    await this.mq.batchAck(queue, messages.map((m) => m.id));
                  }
                } catch (e: any) {
                  console.error(
                    "Execution of mqSubscription for queue",
                    queue,
                    "invoking",
                    name,
                    "with messages",
                    messages,
                    "failed:",
                    e,
                  );
                }
              },
            ),
          );
        }
      }
    }
  }

  validateManifest(manifest: Manifest<MQHookT>): string[] {
    const errors: string[] = [];
    for (const functionDef of Object.values(manifest.functions)) {
      if (!functionDef.mqSubscriptions) {
        continue;
      }
      for (const subscriptionDef of functionDef.mqSubscriptions) {
        if (!subscriptionDef.queue) {
          errors.push("Missing queue name for mqSubscription");
        }
      }
    }
    return errors;
  }
}
