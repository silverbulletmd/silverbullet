import { Hook, Manifest } from "../types.ts";
import { Cron } from "https://cdn.jsdelivr.net/gh/hexagon/croner@4/src/croner.js";
import { safeRun } from "../util.ts";
import { System } from "../system.ts";
import { timingSafeEqual } from "https://deno.land/std@0.152.0/crypto/timing_safe_equal";

export type CronHookT = {
  cron?: string | string[];
};

export class CronHook implements Hook<CronHookT> {
  tasks: Cron[] = [];
  constructor(private system: System<CronHookT>) {
  }

  apply(system: System<CronHookT>): void {
    this.system = system;
    system.on({
      plugLoaded: () => {
        this.reloadCrons();
      },
      plugUnloaded: () => {
        this.reloadCrons();
      },
    });

    this.reloadCrons();
  }

  stop() {
    this.tasks.forEach((task) => task.stop());
    this.tasks = [];
  }

  reloadCrons() {
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
        if (!functionDef.cron) {
          continue;
        }
        const crons = Array.isArray(functionDef.cron)
          ? functionDef.cron
          : [functionDef.cron];
        for (const cronDef of crons) {
          this.tasks.push(
            new Cron(cronDef, () => {
              // console.log("Now acting on cron", cronDef);
              safeRun(async () => {
                try {
                  await plug.invoke(name, [cronDef]);
                } catch (e: any) {
                  console.error("Execution of cron function failed", e);
                }
              });
            }),
          );
        }
      }
    }
  }

  validateManifest(manifest: Manifest<CronHookT>): string[] {
    const errors: string[] = [];
    for (const functionDef of Object.values(manifest.functions)) {
      if (!functionDef.cron) {
        continue;
      }
      const crons = Array.isArray(functionDef.cron)
        ? functionDef.cron
        : [functionDef.cron];
      for (const _cronDef of crons) {
        // if (!cron.validate(cronDef)) {
        //   errors.push(`Invalid cron expression ${cronDef}`);
        // }
      }
    }
    return errors;
  }
}
