import { Hook, Manifest } from "../types";
import cron, { ScheduledTask } from "node-cron";
import { safeRun } from "../util";
import { System } from "../system";

export type CronHookT = {
  cron?: string | string[];
};

export class NodeCronHook implements Hook<CronHookT> {
  apply(system: System<CronHookT>): void {
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
      tasks.forEach((task) => task.stop());
      tasks = [];
      for (let plug of system.loadedPlugs.values()) {
        if (!plug.manifest) {
          continue;
        }
        for (const [name, functionDef] of Object.entries(
          plug.manifest.functions
        )) {
          if (!functionDef.cron) {
            continue;
          }
          const crons = Array.isArray(functionDef.cron)
            ? functionDef.cron
            : [functionDef.cron];
          for (let cronDef of crons) {
            tasks.push(
              cron.schedule(cronDef, () => {
                console.log("Now acting on cron", cronDef);
                safeRun(async () => {
                  try {
                    await plug.invoke(name, [cronDef]);
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

  validateManifest(manifest: Manifest<CronHookT>): string[] {
    let errors = [];
    for (const [name, functionDef] of Object.entries(manifest.functions)) {
      if (!functionDef.cron) {
        continue;
      }
      const crons = Array.isArray(functionDef.cron)
        ? functionDef.cron
        : [functionDef.cron];
      for (let cronDef of crons) {
        if (!cron.validate(cronDef)) {
          errors.push(`Invalid cron expression ${cronDef}`);
        }
      }
    }
    return errors;
  }
}
