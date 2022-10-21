import { Wasm } from "../build/sqlite.js";
import { SqliteError } from "./error.ts";

// Move string to C
export function setStr<T>(
  wasm: Wasm,
  str: string,
  closure: (ptr: number) => T,
): T {
  const bytes = new TextEncoder().encode(str);
  const ptr = wasm.malloc(bytes.length + 1);
  if (ptr === 0) {
    throw new SqliteError("Out of memory.");
  }
  const mem = new Uint8Array(wasm.memory.buffer, ptr, bytes.length + 1);
  mem.set(bytes);
  mem[bytes.length] = 0; // \0 terminator
  try {
    const result = closure(ptr);
    wasm.free(ptr);
    return result;
  } catch (error) {
    wasm.free(ptr);
    throw error;
  }
}

// Move Uint8Array to C
export function setArr<T>(
  wasm: Wasm,
  arr: Uint8Array,
  closure: (ptr: number) => T,
): T {
  const ptr = wasm.malloc(arr.length);
  if (ptr === 0) {
    throw new SqliteError("Out of memory.");
  }
  const mem = new Uint8Array(wasm.memory.buffer, ptr, arr.length);
  mem.set(arr);
  try {
    const result = closure(ptr);
    wasm.free(ptr);
    return result;
  } catch (error) {
    wasm.free(ptr);
    throw error;
  }
}

// Read string from C
export function getStr(wasm: Wasm, ptr: number): string {
  const len = wasm.str_len(ptr);
  const bytes = new Uint8Array(wasm.memory.buffer, ptr, len);
  if (len > 16) {
    return new TextDecoder().decode(bytes);
  } else {
    // This optimization is lifted from EMSCRIPTEN's glue code
    let str = "";
    let idx = 0;
    while (idx < len) {
      let u0 = bytes[idx++];
      if (!(u0 & 0x80)) {
        str += String.fromCharCode(u0);
        continue;
      }
      const u1 = bytes[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) {
        str += String.fromCharCode(((u0 & 31) << 6) | u1);
        continue;
      }
      const u2 = bytes[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        // cut warning
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (bytes[idx++] & 63);
      }
      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        const ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
    return str;
  }
}
