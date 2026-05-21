import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import type {
  MQMessage,
  MQSubscribeOptions,
} from "@silverbulletmd/silverbullet/type/datastore";
import type { MQHookT } from "@silverbulletmd/silverbullet/type/manifest";
import type { Config } from "../../config.ts";
import type { DataStoreMQ, QueueWorker } from "../../data/mq.datastore.ts";
import type { System } from "../system.ts";
import type { Hook, Manifest } from "../types.ts";

export type MQListenerSpec = MQSubscribeOptions & {
  queue: string;
  autoAck?: boolean;
  run: Function;
};

export class MQHook implements Hook<MQHookT> {
  subscriptions: QueueWorker[] = [];
  private cleanupListeners: (() => void)[] = [];
  throttledReloadQueues = throttle(() => {
    this.reloadQueues();
  }, 1000);

  constructor(
    private system: System<MQHookT>,
    readonly mq: DataStoreMQ,
    readonly config: Config,
  ) {}

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

    if (typeof window !== "undefined") {
      let idleTimer: any = null;
      const onActivity = () => {
        // Pause indexing queue when user is active
        this.mq.setQueuePaused("indexQueue", true);
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          this.mq.setQueuePaused("indexQueue", false);
        }, 2000); // Resume indexing after 2s of idleness
      };

      // Throttle activity listener to not trigger state transitions continuously
      const throttledActivity = throttle(onActivity, 250);

      const events = [
        "mousedown",
        "mousemove",
        "keydown",
        "scroll",
        "touchstart",
      ];
      for (const ev of events) {
        window.addEventListener(ev, throttledActivity, { passive: true });
      }

      this.cleanupListeners.push(() => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        for (const ev of events) {
          window.removeEventListener(ev, throttledActivity);
        }
        // Make sure it's unpaused if hook is stopped/unloaded
        this.mq.setQueuePaused("indexQueue", false);
      });
    }
  }

  stop() {
    this.subscriptions.forEach((worker) => worker.stop());
    this.subscriptions = [];
    this.cleanupListeners.forEach((cleanup) => cleanup());
    this.cleanupListeners = [];
  }

  reloadQueues() {
    this.stop();
    // Plug based subscriptions
    for (const plug of this.system.loadedPlugs.values()) {
      if (!plug.manifest) {
        continue;
      }
      for (const [name, functionDef] of Object.entries(
        plug.manifest.functions,
      )) {
        if (!functionDef.mqSubscriptions) {
          continue;
        }
        const subscriptions = functionDef.mqSubscriptions;
        for (const subscriptionDef of subscriptions) {
          const queue = subscriptionDef.queue;
          // Use a minimum pollInterval of 5000ms for the indexQueue to reduce
          // IDB contention with the main thread. The index plug doesn't set a
          // pollInterval so it defaults to 1s, which saturates IndexedDB.
          // Wakeup-based signalling (wakeupWorker) still delivers messages
          // immediately when new items arrive, so the idle poll is only a
          // fallback for missed wakeups.
          const pollInterval =
            queue === "indexQueue"
              ? Math.max(subscriptionDef.pollInterval ?? 0, 5000)
              : subscriptionDef.pollInterval;
          // For the indexQueue, add a mandatory inter-batch pause so the
          // worker yields the event loop between every batch, letting the main
          // thread's IDB reads and UI rendering run without starvation.
          const interBatchDelay = queue === "indexQueue" ? 1000 : undefined;
          this.subscriptions.push(
            this.mq.subscribe(
              queue,
              {
                batchSize: subscriptionDef.batchSize,
                pollInterval,
                interBatchDelay,
              },
              async (messages: MQMessage[]) => {
                try {
                  await plug.invoke(name, [messages]);
                  if (subscriptionDef.autoAck) {
                    await this.mq.batchAck(
                      queue,
                      messages.map((m) => m.id),
                    );
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
    // Space Lua based subscriptions
    const configListeners: Record<string, MQListenerSpec[]> = this.config.get(
      "mqSubscriptions",
      {},
    );
    for (const [queue, listeners] of Object.entries(configListeners)) {
      for (const listener of listeners) {
        // console.log("Subscribing to", queue, listener);
        this.subscriptions.push(
          this.mq.subscribe(
            queue,
            {
              batchSize: listener.batchSize,
              pollInterval: listener.pollInterval,
            },
            async (messages: MQMessage[]) => {
              try {
                await listener.run(messages);
                if (listener.autoAck) {
                  await this.mq.batchAck(
                    queue,
                    messages.map((m) => m.id),
                  );
                }
              } catch (e: any) {
                console.error(
                  "Execution of mqSubscription for queue",
                  queue,
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
