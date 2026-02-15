import { expect, test } from "vitest";
import { BoxProxy } from "./box_proxy.ts";

test("Test LateBinder - basic get functionality", () => {
  const binder = new BoxProxy({
    returnNumber: () => 1,
  });
  const p = binder.buildProxy();
  expect(p.returnNumber()).toEqual(1);
  // Now swap out target
  binder.setTarget({
    returnNumber: () => 3,
  });
  expect(p.returnNumber()).toEqual(3);
});

test("Test LateBinder - property setting", () => {
  const target: any = { count: 0 };
  const proxy = new BoxProxy(target).buildProxy();

  proxy.count = 5;
  expect(target.count).toEqual(5);
  expect(proxy.count).toEqual(5);

  proxy.newProp = "test";
  expect(target.newProp).toEqual("test");
  expect(proxy.newProp).toEqual("test");
});

test("Test LateBinder - has operator", () => {
  const proxy = new BoxProxy({
    existing: true,
    nested: { prop: "value" },
  }).buildProxy();

  expect("existing" in proxy).toEqual(true);
  expect("nested" in proxy).toEqual(true);
  expect("nonexistent" in proxy).toEqual(false);
});

test("Test LateBinder - delete property", () => {
  const target: any = {
    prop1: "value1",
    prop2: "value2",
  };
  const proxy = new BoxProxy(target).buildProxy();

  expect("prop1" in proxy).toEqual(true);
  delete proxy.prop1;
  expect("prop1" in proxy).toEqual(false);
  expect("prop1" in target).toEqual(false);

  expect("prop2" in proxy).toEqual(true);
});

test("Test LateBinder - ownKeys", () => {
  const target = {
    prop1: "value1",
    prop2: "value2",
    method: () => "result",
  };
  const proxy = new BoxProxy(target).buildProxy();

  const keys = Object.keys(proxy);
  const expectedKeys = Object.keys(target);
  expect(keys.sort()).toEqual(expectedKeys.sort());
});

test("Test LateBinder - with functions and methods", () => {
  const target: any = {
    multiplier: 2,
    multiply: function (x: number) {
      return x * this.multiplier;
    },
    arrow: (x: number) => x * 3,
  };

  const proxy = new BoxProxy(target).buildProxy();

  expect(proxy.multiply(5)).toEqual(10);
  expect(proxy.arrow(4)).toEqual(12);
  expect(proxy.multiplier).toEqual(2);
});

test("Test LateBinder - complex object interactions", () => {
  const target: any = {
    data: { nested: { value: 42 } },
    getValue: function () {
      return this.data.nested.value;
    },
  };

  const proxy = new BoxProxy(target).buildProxy();

  expect(proxy.getValue()).toEqual(42);

  proxy.data.nested.value = 100;
  expect(proxy.getValue()).toEqual(100);
  expect(target.data.nested.value).toEqual(100);
});

test("Test LateBinder - target switching with different interfaces", () => {
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

  expect(proxy.add(2, 3)).toEqual(5);

  binder.setTarget(calc2);
  expect(proxy.add(2, 3)).toEqual(6);
});

test("Test LateBinder - empty target", () => {
  const proxy = new BoxProxy({}).buildProxy();

  expect(Object.keys(proxy).length).toEqual(0);
  expect("anything" in proxy).toEqual(false);

  (proxy as any).newProp = "added";
  expect((proxy as any).newProp).toEqual("added");
  expect("newProp" in proxy).toEqual(true);
});
