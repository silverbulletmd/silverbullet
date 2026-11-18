import { expect, test } from "vitest";
import { describeFieldError, splitFieldErrors } from "./field_errors.ts";

test("names the field the way the form labels it, never by its API key", () => {
  expect(
    describeFieldError({
      field: "adminUsername",
      message: "invalid username",
    }),
  ).toBe("Username: Invalid username");
  expect(
    describeFieldError({
      field: "space.prefix",
      message: "prefix is required",
    }),
  ).toBe("Path: Prefix is required");
  expect(
    describeFieldError({
      field: "7f3c2a.binding",
      message: "overlaps another space",
    }),
  ).toBe("Path: Overlaps another space");
  expect(
    describeFieldError({ field: "primaryUrl", message: "must be absolute" }),
  ).toBe("Server address: Must be absolute");
});

test("shows only the message for an unknown or empty field", () => {
  expect(describeFieldError({ field: "", message: "request failed" })).toBe(
    "Request failed",
  );
  expect(describeFieldError({ field: "mysteryKey", message: "nope" })).toBe(
    "Nope",
  );
});

test("splits errors into the form's own fields and the rest", () => {
  const { byField, other } = splitFieldErrors(
    [
      { field: "space.name", message: "name is required" },
      { field: "space.host", message: "hostname is required" },
      { field: "", message: "this server is already configured" },
    ],
    ["name", "folder"],
  );
  expect(byField).toEqual({ name: "Name is required" });
  expect(other.map(describeFieldError)).toEqual([
    "Hostname: Hostname is required",
    "This server is already configured",
  ]);
});
