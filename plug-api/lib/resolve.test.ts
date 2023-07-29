import { resolvePath } from "$sb/lib/resolve.ts";
import { assertEquals } from "../../test_deps.ts";

Deno.test("Test URL resolver", () => {
  assertEquals(resolvePath("test", "some page"), "some page");
  assertEquals(
    resolvePath("!silverbullet.md", "some page"),
    "!silverbullet.md/some page",
  );
  assertEquals(
    resolvePath("!silverbullet.md/some/deep/path", "some page"),
    "!silverbullet.md/some page",
  );
  assertEquals(resolvePath("!bla/bla", "!bla/bla2"), "!bla/bla2");

  assertEquals(
    resolvePath("!silverbullet.md", "test/image.png", true),
    "https://silverbullet.md/test/image.png",
  );
});
