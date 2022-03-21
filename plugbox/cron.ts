import { System } from "./runtime";
import { CronHook } from "./types";
import cron from "node-cron";

export function cronSystem(system: System<CronHook>) {
  let task = cron.schedule("* * * * *", () => {

  });
  // @ts-ignore
  task.destroy();
}
