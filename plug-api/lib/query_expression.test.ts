import { evalQueryExpression } from "$sb/lib/query_expression.ts";
import { assert, assertEquals } from "$std/testing/asserts.ts";

Deno.test("Test query expression evaluation", async () => {
  assertEquals(
    evalQueryExpression(
      ["+", ["number", 1], ["number", 2]],
      {},
      {},
      {},
    ),
    3,
  );

  assertEquals(
    evalQueryExpression(
      ["?", [">", ["number", 8], ["number", 3]], ["string", "yes"], [
        "string",
        "no",
      ]],
      {},
      {},
      {},
    ),
    "yes",
  );

  // Only when an expression calls an async function should the result be a
  const prom = evalQueryExpression(
    ["+", ["call", "asyncCall", []], ["number", 2]],
    {},
    {},
    { asyncCall: () => Promise.resolve(1) },
  );
  assert(prom instanceof Promise);
  assertEquals(await prom, 3);
  const nonProm = evalQueryExpression(
    ["+", ["call", "asyncCall", []], ["number", 2]],
    {},
    {},
    { asyncCall: () => 1 },
  );
  assert(!(nonProm instanceof Promise));
  assertEquals(nonProm, 3);
});
