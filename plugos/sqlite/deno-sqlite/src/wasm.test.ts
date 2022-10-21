import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.154.0/testing/asserts.ts";

import { Wasm } from "../build/sqlite.js";
import * as wasm from "./wasm.ts";

function mock(
  malloc: () => number = () => 1,
  free: (pts: number) => void = () => {},
): Wasm {
  const memory = new Uint8Array(2048);
  return {
    malloc,
    free,
    str_len: (ptr: number) => {
      let len = 0;
      for (let idx = ptr; memory.at(idx) != 0; idx++) len++;
      return len;
    },
    memory,
  } as unknown as Wasm;
}

Deno.test("round trip string", function () {
  const mockWasm = mock();
  const testCases = ["Hello world!", "Söme, fünky lëttêrß", "你好👋"];
  for (const input of testCases) {
    const output = wasm.setStr(mockWasm, input, (ptr) => {
      return wasm.getStr(mockWasm, ptr);
    });
    assertEquals(input, output);
  }
});

Deno.test("throws on allocation error", function () {
  const mockWasm = mock(() => 0);
  assertThrows(() => wasm.setStr(mockWasm, "Hello world!", (_) => null));
});
