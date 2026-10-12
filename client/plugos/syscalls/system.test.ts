import { expect, test } from "vitest";
import { System } from "../system.ts";
import { systemSyscalls } from "./system.ts";

test("listSyscalls returns cloneable metadata, without dependsOn", () => {
  const system = new System<any>();
  system.registerSyscalls([], {
    "demo.read": {
      callback: (_ctx: any, name: string) => name,
      dependsOn: (name: string) => [`demo:${name}`],
      description: "Reads.",
    },
  });
  const client = { clientSystem: { system } } as any;
  const list = (systemSyscalls(client, false) as any)[
    "system.listSyscalls"
  ].callback();
  const demo = list.find((s: any) => s.name === "demo.read");
  expect(demo.dependsOn).toBeUndefined();
  // Plug workers receive this through postMessage
  expect(() => structuredClone(list)).not.toThrow();
});
