import { describe, expect, test } from "vitest";
import {
  detectFences,
  hasAnyFence,
  hasFence,
} from "./fence_detector.ts";

describe("detectFences", () => {
  test("empty text", () => {
    expect(detectFences("")).toEqual(new Set());
  });

  test("plain text without fences", () => {
    expect(detectFences("Just some prose.\nNo code here.")).toEqual(new Set());
  });

  test("single fence with info string", () => {
    const md = "Intro\n```space-lua\nprint('hi')\n```\nOutro";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("multiple fences with different info strings", () => {
    const md = [
      "```space-lua",
      "x = 1",
      "```",
      "Some text",
      "```space-style",
      "body { color: red; }",
      "```",
      "More text",
      "```",
      "code without info",
      "```",
    ].join("\n");
    expect(detectFences(md)).toEqual(
      new Set(["space-lua", "space-style"]),
    );
  });

  test("info string is lowercased", () => {
    const md = "```Space-Lua\nfoo\n```";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("fence with leading whitespace up to 3 spaces", () => {
    const md = "   ```space-lua\nfoo\n   ```";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("4 leading spaces is an indented code block, not a fence", () => {
    const md = "    ```space-lua\nfoo\n    ```";
    expect(detectFences(md)).toEqual(new Set());
  });

  test("tilde fence", () => {
    const md = "~~~space-lua\nfoo\n~~~";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("close requires same char as open (tilde won't close backtick fence)", () => {
    const md = "```space-lua\nfoo\n~~~\nstill inside\n```";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("close fence must be at least as long as open", () => {
    const md = "````space-lua\nfoo\n```\nstill inside\n````";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("nested-looking fences inside a fence are not parsed as opens", () => {
    const md = [
      "````md",
      "Inner doc:",
      "```space-lua",
      "x = 1",
      "```",
      "End inner",
      "````",
    ].join("\n");
    expect(detectFences(md)).toEqual(new Set(["md"]));
  });

  test("info string with backtick is rejected for backtick fence", () => {
    const md = "```foo`bar\ncontent\n```";
    expect(detectFences(md)).toEqual(new Set());
  });

  test("info string is trimmed at whitespace", () => {
    const md = "```space-lua  some attribute\nfoo\n```";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("CRLF line endings are tolerated", () => {
    const md = "```space-lua\r\nfoo\r\n```\r\n";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("unterminated fence still records the open info", () => {
    const md = "```space-lua\nfoo\nbar";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("hasFence is case-insensitive", () => {
    const md = "```Space-Lua\nfoo\n```";
    expect(hasFence(md, "SPACE-LUA")).toBe(true);
    expect(hasFence(md, "space-style")).toBe(false);
  });

  test("hasAnyFence matches any of the requested types", () => {
    const md = "```space-style\ncss\n```";
    expect(hasAnyFence(md, ["space-lua", "space-style"])).toBe(true);
    expect(hasAnyFence(md, ["space-lua"])).toBe(false);
  });

  test("close fence with trailing whitespace is allowed", () => {
    const md = "```space-lua\nfoo\n```   \n";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });

  test("close fence with trailing non-whitespace is not a close", () => {
    const md = "```space-lua\nfoo\n``` extra\nstill inside\n```";
    expect(detectFences(md)).toEqual(new Set(["space-lua"]));
  });
});
