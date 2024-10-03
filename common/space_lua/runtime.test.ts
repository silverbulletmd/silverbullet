import { assertEquals } from "@std/assert/equals";
import { LuaMultiRes } from "$common/space_lua/runtime.ts";

Deno.test("Test Lua Rutime", () => {
    // Test LuaMultires

    assertEquals(new LuaMultiRes([]).flatten().values, []);
    assertEquals(new LuaMultiRes([1, 2, 3]).flatten().values, [1, 2, 3]);
    assertEquals(
        new LuaMultiRes([1, new LuaMultiRes([2, 3])]).flatten().values,
        [
            1,
            2,
            3,
        ],
    );
});
