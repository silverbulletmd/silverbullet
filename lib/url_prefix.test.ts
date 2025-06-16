import { assertEquals } from "@std/assert";
import { applyUrlPrefix, removeUrlPrefix } from "./url_prefix.ts";

Deno.test("url_prefix - removeUrlPrefix - with value", async (t) => {
  await t.step("Absolute URL, present, should be removed", () => {
    assertEquals(
      removeUrlPrefix("http://myserver/sb/relevant", "/sb"),
      "http://myserver/relevant",
    );
    assertEquals(
      removeUrlPrefix("https://myserver/sb/relevant", "/sb"),
      "https://myserver/relevant",
    );
  });

  await t.step("Absolute URL, present, should only remove leading", () => {
    assertEquals(
      removeUrlPrefix("http://myserver/sb/sb/relevant/sb", "/sb"),
      "http://myserver/sb/relevant/sb",
    );
    assertEquals(
      removeUrlPrefix("http://myserver/relevant/sb", "/sb"),
      "http://myserver/relevant/sb",
    );
  });

  await t.step("Absolute URL, absent, should be untouched", () => {
    assertEquals(
      removeUrlPrefix("http://myserver/other/relevant", "/sb"),
      "http://myserver/other/relevant",
    );
    assertEquals(
      removeUrlPrefix("https://myserver/other/relevant", "/sb"),
      "https://myserver/other/relevant",
    );
  });

  await t.step("Absolute URL, queryString, should be preserved", () => {
    assertEquals(
      removeUrlPrefix("http://myserver/sb/sb/relevant/sb?param=arg", "/sb"),
      "http://myserver/sb/relevant/sb?param=arg",
    );
  });

  await t.step("Absolute URL, unsupported, should be untouched", () => {
    assertEquals(
      removeUrlPrefix("ftp://myserver/sb/relevant", "/sb"),
      "ftp://myserver/sb/relevant",
    );
  });

  await t.step("Host-Relative URL, present, should be removed", () => {
    assertEquals(removeUrlPrefix("/sb/relevant", "/sb"), "/relevant");
  });

  await t.step("Host-Relative URL, present, should only remove leading", () => {
    assertEquals(
      removeUrlPrefix("/sb/sb/relevant/sb", "/sb"),
      "/sb/relevant/sb",
    );
    assertEquals(removeUrlPrefix("/relevant/sb", "/sb"), "/relevant/sb");
  });

  await t.step("Host-Relative URL, queryString, should be preserved", () => {
    assertEquals(
      removeUrlPrefix("/sb/sb/relevant/sb?param=arg", "/sb"),
      "/sb/relevant/sb?param=arg",
    );
    assertEquals(
      removeUrlPrefix("/relevant/sb?param=arg", "/sb"),
      "/relevant/sb?param=arg",
    );
  });

  await t.step("Host-Relative URL, absent, should be untouched", () => {
    assertEquals(removeUrlPrefix("/other/relevant", "/sb"), "/other/relevant");
  });

  await t.step("Page-Relative URL, should be untouched", () => {
    assertEquals(removeUrlPrefix("sb/relevant", "/sb"), "sb/relevant");
  });
});

Deno.test("url_prefix - removeUrlPrefix - no value", async (t) => {
  await t.step("Absolute URL, should be untouched", () => {
    assertEquals(
      removeUrlPrefix("http://myserver/sb/relevant", ""),
      "http://myserver/sb/relevant",
    );
    assertEquals(
      removeUrlPrefix("https://myserver/sb/relevant"),
      "https://myserver/sb/relevant",
    );
  });

  await t.step("Host-Relative URL, should be untouched", () => {
    assertEquals(removeUrlPrefix("/sb/relevant", ""), "/sb/relevant");
    assertEquals(removeUrlPrefix("/sb/relevant"), "/sb/relevant");
  });

  await t.step("Page-Relative URL, should be untouched", () => {
    assertEquals(removeUrlPrefix("sb/relevant", ""), "sb/relevant");
    assertEquals(removeUrlPrefix("sb/relevant"), "sb/relevant");
  });
});

Deno.test("url_prefix - applyUrlPrefix - with value", async (t) => {
  await t.step("string, Absolute URL, should be prefixed", () => {
    assertEquals(
      applyUrlPrefix("http://myserver/relevant", "/sb"),
      "http://myserver/sb/relevant",
    );
    assertEquals(
      applyUrlPrefix("https://myserver/relevant", "/sb"),
      "https://myserver/sb/relevant",
    );
  });

  await t.step("string, Absolute URL, should not care about dups", () => {
    assertEquals(
      applyUrlPrefix("http://myserver/sb/relevant/sb", "/sb"),
      "http://myserver/sb/sb/relevant/sb",
    );
  });

  await t.step("string, Absolute URL, queryString should be preserved", () => {
    assertEquals(
      applyUrlPrefix("http://myserver/sb/relevant/sb?param=arg", "/sb"),
      "http://myserver/sb/sb/relevant/sb?param=arg",
    );
  });

  await t.step("string, Absolute URL, unsupported, should be untouched", () => {
    assertEquals(
      applyUrlPrefix("ftp://myserver/relevant", "/sb"),
      "ftp://myserver/relevant",
    );
  });

  await t.step("string, Host-Relative URL, should be prefixed", () => {
    assertEquals(applyUrlPrefix("/relevant", "/sb"), "/sb/relevant");
  });

  await t.step("string, Host-Relative URL, should not care about dups", () => {
    assertEquals(
      applyUrlPrefix("/sb/relevant/sb", "/sb"),
      "/sb/sb/relevant/sb",
    );
  });

  await t.step(
    "string, Host-Relative URL, queryString should be preserved",
    () => {
      assertEquals(
        applyUrlPrefix("/sb/relevant/sb?param=arg", "/sb"),
        "/sb/sb/relevant/sb?param=arg",
      );
    },
  );

  await t.step("string, Page-Relative URL, should be untouched", () => {
    assertEquals(applyUrlPrefix("relevant", "/sb"), "relevant");
  });

  await t.step("URL object, Absolute URL, should be prefixed", () => {
    assertEquals(
      applyUrlPrefix(new URL("http://myserver/relevant"), "/sb"),
      new URL("http://myserver/sb/relevant"),
    );
  });

  await t.step(
    "URL object, Absolute URL, queryString should be preserved",
    () => {
      assertEquals(
        applyUrlPrefix(new URL("http://myserver/relevant?param=arg"), "/sb"),
        new URL("http://myserver/sb/relevant?param=arg"),
      );
    },
  );
});

Deno.test("url_prefix - applyUrlPrefix - no value", async (t) => {
  await t.step("Absolute URL, should be untouched", () => {
    assertEquals(
      applyUrlPrefix("http://myserver/relevant", ""),
      "http://myserver/relevant",
    );
    assertEquals(
      applyUrlPrefix("https://myserver/relevant"),
      "https://myserver/relevant",
    );
  });

  await t.step("Host-Relative URL, should be untouched", () => {
    assertEquals(applyUrlPrefix("/relevant", ""), "/relevant");
    assertEquals(applyUrlPrefix("/relevant"), "/relevant");
  });

  await t.step("Page-Relative URL, should be untouched", () => {
    assertEquals(applyUrlPrefix("relevant", ""), "relevant");
    assertEquals(applyUrlPrefix("relevant"), "relevant");
  });
});
