import { expect, test } from "vitest";
import { applyUrlPrefix, removeUrlPrefix } from "./url_prefix.ts";

test("url_prefix - removeUrlPrefix - with value", async () => {
  // Absolute URL, present, should be removed
  expect(
    removeUrlPrefix("http://myserver/sb/relevant", "/sb"),
  ).toEqual("http://myserver/relevant");
  expect(
    removeUrlPrefix("https://myserver/sb/relevant", "/sb"),
  ).toEqual("https://myserver/relevant");

  // Absolute URL, present, should only remove leading
  expect(
    removeUrlPrefix("http://myserver/sb/sb/relevant/sb", "/sb"),
  ).toEqual("http://myserver/sb/relevant/sb");
  expect(
    removeUrlPrefix("http://myserver/relevant/sb", "/sb"),
  ).toEqual("http://myserver/relevant/sb");

  // Absolute URL, absent, should be untouched
  expect(
    removeUrlPrefix("http://myserver/other/relevant", "/sb"),
  ).toEqual("http://myserver/other/relevant");
  expect(
    removeUrlPrefix("https://myserver/other/relevant", "/sb"),
  ).toEqual("https://myserver/other/relevant");

  // Absolute URL, queryString, should be preserved
  expect(
    removeUrlPrefix("http://myserver/sb/sb/relevant/sb?param=arg", "/sb"),
  ).toEqual("http://myserver/sb/relevant/sb?param=arg");

  // Absolute URL, unsupported, should be untouched
  expect(
    removeUrlPrefix("ftp://myserver/sb/relevant", "/sb"),
  ).toEqual("ftp://myserver/sb/relevant");

  // Host-Relative URL, present, should be removed
  expect(removeUrlPrefix("/sb/relevant", "/sb")).toEqual("/relevant");

  // Host-Relative URL, present, should only remove leading
  expect(
    removeUrlPrefix("/sb/sb/relevant/sb", "/sb"),
  ).toEqual("/sb/relevant/sb");
  expect(removeUrlPrefix("/relevant/sb", "/sb")).toEqual("/relevant/sb");

  // Host-Relative URL, queryString, should be preserved
  expect(
    removeUrlPrefix("/sb/sb/relevant/sb?param=arg", "/sb"),
  ).toEqual("/sb/relevant/sb?param=arg");
  expect(
    removeUrlPrefix("/relevant/sb?param=arg", "/sb"),
  ).toEqual("/relevant/sb?param=arg");

  // Host-Relative URL, absent, should be untouched
  expect(removeUrlPrefix("/other/relevant", "/sb")).toEqual("/other/relevant");

  // Page-Relative URL, should be untouched
  expect(removeUrlPrefix("sb/relevant", "/sb")).toEqual("sb/relevant");
});

test("url_prefix - removeUrlPrefix - no value", async () => {
  // Absolute URL, should be untouched
  expect(
    removeUrlPrefix("http://myserver/sb/relevant", ""),
  ).toEqual("http://myserver/sb/relevant");
  expect(
    removeUrlPrefix("https://myserver/sb/relevant"),
  ).toEqual("https://myserver/sb/relevant");

  // Host-Relative URL, should be untouched
  expect(removeUrlPrefix("/sb/relevant", "")).toEqual("/sb/relevant");
  expect(removeUrlPrefix("/sb/relevant")).toEqual("/sb/relevant");

  // Page-Relative URL, should be untouched
  expect(removeUrlPrefix("sb/relevant", "")).toEqual("sb/relevant");
  expect(removeUrlPrefix("sb/relevant")).toEqual("sb/relevant");
});

test("url_prefix - applyUrlPrefix - with value", async () => {
  // string, Absolute URL, should be prefixed
  expect(
    applyUrlPrefix("http://myserver/relevant", "/sb"),
  ).toEqual("http://myserver/sb/relevant");
  expect(
    applyUrlPrefix("https://myserver/relevant", "/sb"),
  ).toEqual("https://myserver/sb/relevant");

  // string, Absolute URL, should not care about dups
  expect(
    applyUrlPrefix("http://myserver/sb/relevant/sb", "/sb"),
  ).toEqual("http://myserver/sb/sb/relevant/sb");

  // string, Absolute URL, queryString should be preserved
  expect(
    applyUrlPrefix("http://myserver/sb/relevant/sb?param=arg", "/sb"),
  ).toEqual("http://myserver/sb/sb/relevant/sb?param=arg");

  // string, Absolute URL, unsupported, should be untouched
  expect(
    applyUrlPrefix("ftp://myserver/relevant", "/sb"),
  ).toEqual("ftp://myserver/relevant");

  // string, Host-Relative URL, should be prefixed
  expect(applyUrlPrefix("/relevant", "/sb")).toEqual("/sb/relevant");

  // string, Host-Relative URL, should not care about dups
  expect(
    applyUrlPrefix("/sb/relevant/sb", "/sb"),
  ).toEqual("/sb/sb/relevant/sb");

  // string, Host-Relative URL, queryString should be preserved
  expect(
    applyUrlPrefix("/sb/relevant/sb?param=arg", "/sb"),
  ).toEqual("/sb/sb/relevant/sb?param=arg");

  // string, Page-Relative URL, should be untouched
  expect(applyUrlPrefix("relevant", "/sb")).toEqual("relevant");

  // URL object, Absolute URL, should be prefixed
  expect(
    applyUrlPrefix(new URL("http://myserver/relevant"), "/sb"),
  ).toEqual(new URL("http://myserver/sb/relevant"));

  // URL object, Absolute URL, queryString should be preserved
  expect(
    applyUrlPrefix(new URL("http://myserver/relevant?param=arg"), "/sb"),
  ).toEqual(new URL("http://myserver/sb/relevant?param=arg"));
});

test("url_prefix - applyUrlPrefix - no value", async () => {
  // Absolute URL, should be untouched
  expect(
    applyUrlPrefix("http://myserver/relevant", ""),
  ).toEqual("http://myserver/relevant");
  expect(
    applyUrlPrefix("https://myserver/relevant"),
  ).toEqual("https://myserver/relevant");

  // Host-Relative URL, should be untouched
  expect(applyUrlPrefix("/relevant", "")).toEqual("/relevant");
  expect(applyUrlPrefix("/relevant")).toEqual("/relevant");

  // Page-Relative URL, should be untouched
  expect(applyUrlPrefix("relevant", "")).toEqual("relevant");
  expect(applyUrlPrefix("relevant")).toEqual("relevant");
});
