import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventHook } from "./plugos/hooks/event.ts";
import { System } from "./plugos/system.ts";
import { ServiceRegistry } from "./service_registry.ts";
import { assertEquals } from "@std/assert";
import { Config } from "./config.ts";

Deno.test("Test services", async () => {
  const system = new System<EventHookT>();
  const config = new Config();
  const eventHook = new EventHook(config);
  system.addHook(eventHook);

  const registry = new ServiceRegistry(eventHook, config);

  registry.define({
    selector: "greeter",
    match: {
      priority: 1,
    },
    run: (name: string) => {
      return Promise.resolve(`Hello ${name}!`);
    },
  });

  registry.define({
    selector: "greeter-multi",
    match: () => {
      return Promise.resolve({
        priority: 1,
      });
    },
    run: (name: string) => {
      return Promise.resolve(`Hello 1 ${name}!`);
    },
  });

  registry.define({
    selector: "greeter-multi",
    match: {
      priority: 2,
    },
    run: (name: string) => {
      return Promise.resolve(`Hello 2 ${name}!`);
    },
  });

  registry.define({
    selector: "greeter-multi",
    match: () => {
      return Promise.resolve(null);
    },
    run: () => {
      throw new Error("I should never be run");
    },
  });

  const matches = await registry.discover("greeter", {});
  assertEquals(matches.length, 1);
  assertEquals(matches[0].priority, 1);

  const matchesMulti = await registry.discover("greeter-multi", {});
  assertEquals(matchesMulti.length, 2);
  // higher prio should come first
  assertEquals(matchesMulti[0].priority, 2);
  assertEquals(matchesMulti[1].priority, 1);

  assertEquals(await registry.invoke(matches[0], "Pete"), "Hello Pete!");
  assertEquals(
    await registry.invokeBestMatch("greeter", "Pete"),
    "Hello Pete!",
  );

  assertEquals(
    await registry.invokeBestMatch("greeter-multi", "Pete"),
    "Hello 2 Pete!",
  );
});
