import { assertEquals } from "@std/assert";
import { BoxProxy } from "./box_proxy.ts";

Deno.test("Test LateBinder - basic get functionality", () => {
  const binder = new BoxProxy({
    returnNumber: () => 1,
  });
  const p = binder.buildProxy();
  assertEquals(p.returnNumber(), 1);
  // Now swap out target
  binder.setTarget({
    returnNumber: () => 3,
  });
  assertEquals(p.returnNumber(), 3);
});

Deno.test("Test LateBinder - property setting", () => {
  const target: any = { count: 0 };
  const proxy = new BoxProxy(target).buildProxy();

  proxy.count = 5;
  assertEquals(target.count, 5);
  assertEquals(proxy.count, 5);

  proxy.newProp = "test";
  assertEquals(target.newProp, "test");
  assertEquals(proxy.newProp, "test");
});

Deno.test("Test LateBinder - has operator", () => {
  const proxy = new BoxProxy({
    existing: true,
    nested: { prop: "value" },
  }).buildProxy();

  assertEquals("existing" in proxy, true);
  assertEquals("nested" in proxy, true);
  assertEquals("nonexistent" in proxy, false);
});

Deno.test("Test LateBinder - delete property", () => {
  const target: any = {
    prop1: "value1",
    prop2: "value2",
  };
  const proxy = new BoxProxy(target).buildProxy();

  assertEquals("prop1" in proxy, true);
  delete proxy.prop1;
  assertEquals("prop1" in proxy, false);
  assertEquals("prop1" in target, false);

  assertEquals("prop2" in proxy, true);
});

Deno.test("Test LateBinder - ownKeys", () => {
  const target = {
    prop1: "value1",
    prop2: "value2",
    method: () => "result",
  };
  const proxy = new BoxProxy(target).buildProxy();

  const keys = Object.keys(proxy);
  const expectedKeys = Object.keys(target);
  assertEquals(keys.sort(), expectedKeys.sort());
});

Deno.test("Test LateBinder - with functions and methods", () => {
  const target: any = {
    multiplier: 2,
    multiply: function (x: number) {
      return x * this.multiplier;
    },
    arrow: (x: number) => x * 3,
  };

  const proxy = new BoxProxy(target).buildProxy();

  assertEquals(proxy.multiply(5), 10);
  assertEquals(proxy.arrow(4), 12);
  assertEquals(proxy.multiplier, 2);
});

Deno.test("Test LateBinder - complex object interactions", () => {
  const target: any = {
    data: { nested: { value: 42 } },
    getValue: function () {
      return this.data.nested.value;
    },
  };

  const proxy = new BoxProxy(target).buildProxy();

  assertEquals(proxy.getValue(), 42);

  proxy.data.nested.value = 100;
  assertEquals(proxy.getValue(), 100);
  assertEquals(target.data.nested.value, 100);
});

Deno.test("Test LateBinder - target switching with different interfaces", () => {
  interface Calculator {
    add(a: number, b: number): number;
  }

  const calc1: Calculator = {
    add: (a, b) => a + b,
  };

  const calc2: Calculator = {
    add: (a, b) => a + b + 1, // adds extra 1
  };

  const binder = new BoxProxy(calc1);
  const proxy = binder.buildProxy();

  assertEquals(proxy.add(2, 3), 5);

  binder.setTarget(calc2);
  assertEquals(proxy.add(2, 3), 6);
});

Deno.test("Test LateBinder - empty target", () => {
  const proxy = new BoxProxy({}).buildProxy();

  assertEquals(Object.keys(proxy).length, 0);
  assertEquals("anything" in proxy, false);

  (proxy as any).newProp = "added";
  assertEquals((proxy as any).newProp, "added");
  assertEquals("newProp" in proxy, true);
});
