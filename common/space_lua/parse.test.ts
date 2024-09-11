import { parse } from "$common/space_lua/parse.ts";
import { assertEquals } from "@std/assert/equals";

Deno.test("Test Lua parser", () => {
    // Basic block test
    parse(`
        print("Hello, World!")
        print(10)
`);
    parse("");
    // Expression tests
    parse(
        `e(1, 1.2, -3.8, +4, true, false, nil, "string", "Hello there \x00", ...)`,
    );
    parse(`e(10 << 10, 10 >> 10, 10 & 10, 10 | 10, 10 ~ 10)`);

    assertEquals(
        parse(`e(1 + 2 - 3 * 4 / 4)`),
        parse(`e(1 + 2 - ((3 * 4) / 4))`),
    );
    parse(`e(true and false or true)`);
    parse(`e(a < 3 and b > 4 or b == 5 or c <= 6 and d >= 7 or a /= 8)`);
    parse(`e(a.b.c)`);
    parse(`e((1+2))`);

    // Table expressions
    parse(`e({})`);
    parse(`e({1, 2, 3, })`);
    parse(`e({1 ; 2 ; 3})`);
    parse(`e({a = 1, b = 2, c = 3})`);
    parse(`e({[3] = 1, [10 * 10] = "sup"})`);

    // Function calls
    parse(`e(func(), func(1, 2, 3), a.b(), a.b.c:hello(), (a.b)(7))`);

    // Function expression
    parse(`function sayHi()
print("Hi")
end`);
    parse(`e(function(a, b) end)`);
    parse(`e(function(a, b, ...) end)`);
});
