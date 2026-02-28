import { expect, test } from "vitest";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventHook } from "./plugos/hooks/event.ts";
import { System } from "./plugos/system.ts";
import { ServiceRegistry } from "./service_registry.ts";
import { Config } from "./config.ts";

test("Test services", async () => {
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
  expect(matches.length).toEqual(1);
  expect(matches[0].priority).toEqual(1);

  const matchesMulti = await registry.discover("greeter-multi", {});
  expect(matchesMulti.length).toEqual(2);
  // higher prio should come first
  expect(matchesMulti[0].priority).toEqual(2);
  expect(matchesMulti[1].priority).toEqual(1);

  expect(await registry.invoke(matches[0], "Pete")).toEqual("Hello Pete!");
  expect(await registry.invokeBestMatch("greeter", "Pete")).toEqual("Hello Pete!");

  expect(await registry.invokeBestMatch("greeter-multi", "Pete")).toEqual("Hello 2 Pete!");
});
