import { sleep } from "$lib/async.ts";
import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { JWTIssuer } from "./crypto.ts";

Deno.test("Test JWT crypto", async () => {
  const db = new MemoryKvPrimitives();
  const jwt = new JWTIssuer(db);
  await jwt.init("test");
  // Timeout value is 0 seconds, which means it should expire immediately with a 1 second grace period
  const token = await jwt.createJWT({ user: "pete", role: "admin" }, 0);
  const verified = await jwt.verifyAndDecodeJWT(token);
  assertEquals(verified.user, "pete");
  try {
    await jwt.verifyAndDecodeJWT(token + "bla");
    assertEquals(true, false, "Should have thrown invalid signature");
  } catch {
    // expected
  }
  await sleep(1500);
  try {
    await jwt.verifyAndDecodeJWT(token);
    assertEquals(true, false, "Should have thrown a timeout");
  } catch {
    // expected
  }
});
