import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventHook } from "./plugos/hooks/event.ts";
import { System } from "./plugos/system.ts";
import { ServiceRegistry } from "./service_registry.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("Test services", async () => {
  const system = new System<EventHookT>();
  const eventHook = new EventHook();
  system.addHook(eventHook);

  const registry = new ServiceRegistry(eventHook);

  registry.define({
    selector: "greeter",
    name: "test-greeter",
    match: () => {
      return Promise.resolve({
        priority: 1,
      });
    },
    run: (name: string) => {
      return Promise.resolve(`Hello ${name}!`);
    },
  });

  registry.define({
    selector: "greeter-multi",
    name: "multi-greeter-1",
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
    name: "multi-greeter-2",
    match: () => {
      return Promise.resolve({
        priority: 2,
      });
    },
    run: (name: string) => {
      return Promise.resolve(`Hello 2 ${name}!`);
    },
  });

  registry.define({
    selector: "greeter-multi",
    name: "multi-greeter-never",
    match: () => {
      return Promise.resolve(null);
    },
    run: () => {
      throw new Error("I should never be run");
    },
  });

  const matches = await registry.discover("greeter", {});
  assertEquals(matches.length, 1);
  assertEquals(matches[0].name, "test-greeter");

  const matchesMulti = await registry.discover("greeter-multi", {});
  assertEquals(matchesMulti.length, 2);
  // higher prio should come first
  assertEquals(matchesMulti[0].name, "multi-greeter-2");
  assertEquals(matchesMulti[1].name, "multi-greeter-1");

  assertEquals(await registry.invoke(matches[0].name, "Pete"), "Hello Pete!");
  assertEquals(
    await registry.invokeBestMatch("greeter", "Pete"),
    "Hello Pete!",
  );

  assertEquals(
    await registry.invokeBestMatch("greeter-multi", "Pete"),
    "Hello 2 Pete!",
  );

  try {
    registry.define({
      selector: "greeter-multi",
      // Duplicate name
      name: "multi-greeter-never",
      match: () => {
        return Promise.resolve(null);
      },
      run: () => {
        throw new Error("I should never be run");
      },
    });
    assert(false, "Should have thrown an error");
  } catch {
    // This is the expected case
  }
});
