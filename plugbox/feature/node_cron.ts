import { Feature, Manifest } from "../types";
import cron, { ScheduledTask } from "node-cron";
import { safeRun } from "../util";
import { System } from "../system";

export type CronHook = {
  crons?: CronDef[];
};

export type CronDef = {
  cron: string;
  handler: string; // function name
};

export class NodeCronFeature implements Feature<CronHook> {
  apply(system: System<CronHook>): void {
    let tasks: ScheduledTask[] = [];
    system.on({
      plugLoaded: (name, plug) => {
        reloadCrons();
      },
      plugUnloaded(name, plug) {
        reloadCrons();
      },
    });

    reloadCrons();

    function reloadCrons() {
      // ts-ignore
      tasks.forEach((task) => task.stop());
      tasks = [];
      for (let plug of system.loadedPlugs.values()) {
        const crons = plug.manifest?.hooks?.crons;
        if (crons) {
          for (let cronDef of crons) {
            tasks.push(
              cron.schedule(cronDef.cron, () => {
                console.log("Now acting on cron", cronDef.cron);
                safeRun(async () => {
                  try {
                    await plug.invoke(cronDef.handler, []);
                  } catch (e: any) {
                    console.error("Execution of cron function failed", e);
                  }
                });
              })
            );
          }
        }
      }
    }
  }

  validateManifest(manifest: Manifest<CronHook>): string[] {
    const crons = manifest.hooks.crons;
    let errors = [];
    if (crons) {
      for (let cronDef of crons) {
        if (!cron.validate(cronDef.cron)) {
          errors.push(`Invalid cron expression ${cronDef.cron}`);
        }
        if (!manifest.functions[cronDef.handler]) {
          errors.push(`Cron handler function ${cronDef.handler} not found`);
        }
      }
    }
    return errors;
  }
}
