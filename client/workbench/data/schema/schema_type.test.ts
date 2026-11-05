import { describe, expect, test } from "vitest";
import {
  applyTypeChoice,
  choiceFor,
  readTypeChoice,
  typeKindOf,
  typeLabel,
} from "./schema_type.ts";

const tagsSchema = (extra = {}) => ({
  anyOf: [
    { type: "array", items: { type: "string", format: "tag" } },
    { type: "string", format: "tags" },
  ],
  ...extra,
});
const identitiesSchema = {
  anyOf: [
    { type: "array", items: { type: "string", format: "identity" } },
    { type: "string", format: "identities" },
  ],
};

describe("readTypeChoice", () => {
  test("plain types and string formats", () => {
    expect(readTypeChoice({ type: "integer" })).toEqual({
      kind: "type",
      type: "integer",
      nullable: false,
    });
    expect(readTypeChoice({ type: "string", format: "date" })).toEqual({
      kind: "type",
      type: "string",
      format: "date",
      nullable: false,
    });
    expect(readTypeChoice({ type: "string", format: "tag" })).toMatchObject({
      kind: "type",
      format: "tag",
    });
  });

  test("schema.ref reads as a ref with its target tag", () => {
    expect(
      readTypeChoice({ type: "string", format: "ref", tag: "person" }),
    ).toEqual({ kind: "ref", tag: "person", nullable: false });
  });

  test("schema.tags and schema.identities read as presets", () => {
    expect(readTypeChoice(tagsSchema())).toEqual({
      kind: "tags",
      nullable: false,
    });
    expect(readTypeChoice(identitiesSchema)).toEqual({
      kind: "identities",
      nullable: false,
    });
  });

  test("schema.tags with extra keys reads as tags", () => {
    expect(readTypeChoice(tagsSchema({ description: "Topics" }))).toEqual({
      kind: "tags",
      nullable: false,
    });
  });

  test("nullable anyOf reads as the base type with nullable set", () => {
    expect(
      readTypeChoice({ anyOf: [{ type: "number" }, { type: "null" }] }),
    ).toEqual({ kind: "type", type: "number", nullable: true });
    expect(
      readTypeChoice({
        anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
      }),
    ).toEqual({
      kind: "type",
      type: "array",
      items: { type: "string" },
      nullable: true,
    });
  });

  test("enum is a constraint on string, not a type", () => {
    expect(readTypeChoice({ type: "string", enum: ["a", "b"] })).toEqual({
      kind: "type",
      type: "string",
      enum: ["a", "b"],
      nullable: false,
    });
  });

  test("an anyOf that isn't a helper or nullable is advanced", () => {
    expect(
      readTypeChoice({ anyOf: [{ type: "number" }, { type: "string" }] }),
    ).toMatchObject({ kind: "advanced" });
    expect(readTypeChoice({ oneOf: [{ type: "number" }] })).toMatchObject({
      kind: "advanced",
    });
  });
});

describe("applyTypeChoice", () => {
  test("changing the type keeps description, readOnly and unknown keywords", () => {
    expect(
      applyTypeChoice(
        { type: "string", description: "d", readOnly: true, "x-note": 1 },
        { kind: "type", type: "number", nullable: false },
      ),
    ).toEqual({
      type: "number",
      description: "d",
      readOnly: true,
      "x-note": 1,
    });
  });

  test("a type change drops the old type's format and enum", () => {
    expect(
      applyTypeChoice(
        { type: "string", format: "date", enum: ["x"] },
        { kind: "type", type: "boolean", nullable: false },
      ),
    ).toEqual({ type: "boolean" });
  });

  test("nullable wraps the type in an anyOf with null, keeping annotations outside", () => {
    expect(
      applyTypeChoice(
        { type: "number", description: "d" },
        { kind: "type", type: "number", nullable: true },
      ),
    ).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
      description: "d",
    });
  });

  test("presets produce the helper shapes", () => {
    expect(
      applyTypeChoice(
        { type: "string" },
        { kind: "ref", tag: "person", nullable: false },
      ),
    ).toEqual({ type: "string", format: "ref", tag: "person" });
    expect(
      applyTypeChoice({ type: "string" }, { kind: "tags", nullable: false }),
    ).toEqual(tagsSchema());
    expect(
      applyTypeChoice(
        { type: "string" },
        { kind: "identities", nullable: false },
      ),
    ).toEqual(identitiesSchema);
  });

  test("an advanced choice leaves the schema unchanged", () => {
    const schema = { anyOf: [{ type: "number" }, { type: "string" }] };
    expect(applyTypeChoice(schema, { kind: "advanced", reason: "anyOf" })).toBe(
      schema,
    );
  });

  test("reading then applying the same choice round-trips helper shapes", () => {
    for (const schema of [
      { type: "string", format: "ref", tag: "person" },
      tagsSchema({ description: "Topics" }),
      { anyOf: [{ type: "number" }, { type: "null" }], description: "d" },
      { type: "string", enum: ["a", "b"] },
    ]) {
      expect(applyTypeChoice(schema, readTypeChoice(schema))).toEqual(schema);
    }
  });
});

describe("typeLabel", () => {
  test("reads like the type editor", () => {
    expect(typeLabel({ type: "string", format: "date" })).toBe("string · date");
    expect(typeLabel({ type: "string", format: "ref", tag: "person" })).toBe(
      "ref → person",
    );
    expect(typeLabel(tagsSchema())).toBe("tags");
    expect(typeLabel({ type: "string", enum: ["a", "b"] })).toBe("enum");
    expect(typeLabel({ anyOf: [{ type: "number" }, { type: "null" }] })).toBe(
      "number?",
    );
    expect(typeLabel({ anyOf: [{ type: "number" }, { type: "string" }] })).toBe(
      "anyOf",
    );
  });
});

describe("type menu", () => {
  test("an enum shows as its own entry, a plain type as itself", () => {
    expect(typeKindOf(readTypeChoice({ type: "string", enum: ["a"] }))).toBe(
      "enum",
    );
    expect(typeKindOf(readTypeChoice({ type: "integer" }))).toBe("integer");
    expect(typeKindOf({ kind: "advanced", reason: "anyOf" })).toBeNull();
  });

  test("picking enum again keeps the values, other picks keep nullability", () => {
    const prev = readTypeChoice({ type: "string", enum: ["a", "b"] });
    expect(choiceFor("enum", false, prev)).toEqual({
      kind: "type",
      type: "string",
      enum: ["a", "b"],
      nullable: false,
    });
    expect(choiceFor("ref", true, prev)).toEqual({
      kind: "ref",
      nullable: true,
    });
  });
});
