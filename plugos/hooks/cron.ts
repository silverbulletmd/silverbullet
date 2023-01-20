import { Hook, Manifest } from "../types.ts";
import { Cron } from "https://cdn.jsdelivr.net/gh/hexagon/croner@4/src/croner.js";
import { safeRun } from "../util.ts";
import { System } from "../system.ts";

export type CronHookT = {
  cron?: string | string[];
};

export class CronHook implements Hook<CronHookT> {
  apply(system: System<CronHookT>): void {
    let tasks: Cron[] = [];
    system.on({
      plugLoaded: () => {
        reloadCrons();
      },
      plugUnloaded() {
        reloadCrons();
      },
    });

    reloadCrons();

    function reloadCrons() {
      tasks.forEach((task) => task.stop());
      tasks = [];
      for (const plug of system.loadedPlugs.values()) {
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
            tasks.push(
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
