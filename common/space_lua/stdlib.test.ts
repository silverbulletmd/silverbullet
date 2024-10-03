import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";
import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { LuaTable } from "$common/space_lua/runtime.ts";

Deno.test("Lua Standard Library test", () => {
    const stdlib = luaBuildStandardEnv();
    stdlib.get("print").call([1, 2, 3]);
    stdlib.get("assert").call(true);
    try {
        stdlib.get("assert").call(false, "This should fail");
        assert(false);
    } catch (e: any) {
        assert(e.message.includes("This should fail"));
    }

    const ipairs = stdlib.get("ipairs").call(["a", "b", "c"]);
    assertEquals(ipairs().values, [0, "a"]);
    assertEquals(ipairs().values, [1, "b"]);
    assertEquals(ipairs().values, [2, "c"]);
    assertEquals(ipairs(), undefined);

    const tbl = new LuaTable();
    tbl.set("a", 1);
    tbl.set("b", 2);
    tbl.set("c", 3);
    tbl.set(1, "a");
    const pairs = stdlib.get("pairs").call(tbl);
    assertEquals(pairs().values, ["a", 1]);
    assertEquals(pairs().values, ["b", 2]);
    assertEquals(pairs().values, ["c", 3]);
    assertEquals(pairs().values, [1, "a"]);

    assertEquals(stdlib.get("type").call(1), "number");
    assertEquals(stdlib.get("type").call("a"), "string");
    assertEquals(stdlib.get("type").call(true), "boolean");
    assertEquals(stdlib.get("type").call(null), "nil");
    assertEquals(stdlib.get("type").call(undefined), "nil");
    assertEquals(stdlib.get("type").call(tbl), "table");
});
