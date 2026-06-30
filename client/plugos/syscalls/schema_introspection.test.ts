import { expect, test } from "vitest";
import { describeSchemas, tagSchema } from "./schema_introspection.ts";
import { indexSyscalls } from "./index.ts";

// Fixtures mirroring real config under ["tags"] (plain JS, as config.get returns).
const tags = {
  task: {
    name: "task",
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {
        done: { type: "boolean", readOnly: true },
        state: { type: "string", readOnly: true },
        name: { type: "string", readOnly: true },
        // schema.array("string") shape -> type "array"
        tags: { type: "array", items: { type: "string" } },
        // schema.nullable("string") shape -> anyOf with no top-level type
        deadline: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  },
  page: {
    name: "page",
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {
        // enum + readOnly
        perm: { type: "string", readOnly: true, enum: ["ro", "rw"] },
        name: { type: "string" },
        itags: { type: "array", items: { type: "string" }, nullable: true },
      },
    },
  },
  // Custom tag.define'd tag (e.g. from CONFIG.md)
  person: {
    name: "person",
    schema: {
      type: "object",
      properties: {
        age: { type: "number" },
      },
    },
  },
  // A tag with no schema at all (must be omitted from describeSchemas)
  bareTag: {
    name: "bareTag",
  },
};

test("describeSchemas returns only tags with schemas, keyed by tag name", () => {
  const result = describeSchemas(tags);
  // bareTag has no schema and must be omitted
  expect(Object.keys(result).sort()).toEqual(["page", "person", "task"]);
});

test("describeSchemas returns the unmodified raw JSON Schema for each tag", () => {
  const result = describeSchemas(tags);
  expect((result.task as any).properties.done.type).toBe("boolean");
  expect((result.task as any).additionalProperties).toBe(true);
  // anyOf shape is preserved as-is (not flattened)
  expect((result.task as any).properties.deadline.anyOf).toBeDefined();
  expect((result.page as any).properties.perm.enum).toEqual(["ro", "rw"]);
  expect((result.person as any).properties.age.type).toBe("number");
});

test("tagSchema returns the raw JSON Schema for a defined tag with a schema", () => {
  const schema = tagSchema(tags, "task") as any;
  expect(schema).not.toBeNull();
  expect(schema.type).toBe("object");
  expect(schema.properties.done.type).toBe("boolean");
  expect(schema.properties.done.readOnly).toBe(true);
  // anyOf shape preserved intact
  expect(schema.properties.deadline.anyOf).toBeDefined();
  // array type preserved intact
  expect(schema.properties.tags.type).toBe("array");
  expect(schema.properties.tags.items.type).toBe("string");
});

test("tagSchema returns null for a tag without a schema", () => {
  expect(tagSchema(tags, "bareTag")).toBeNull();
});

test("tagSchema returns null for an undefined tag", () => {
  expect(tagSchema(tags, "doesNotExist")).toBeNull();
});

test("index.describeSchema / index.tagSchema syscalls delegate to config", () => {
  const fakeClient: any = {
    config: { get: (_path: string[], def: any) => tags ?? def },
  };
  const syscalls = indexSyscalls({} as any, fakeClient);
  const all = (syscalls["index.describeSchema"] as any)({}) as Record<
    string,
    unknown
  >;
  // Only tags with schemas are returned (bareTag omitted)
  expect(Object.keys(all).sort()).toEqual(["page", "person", "task"]);
  // Values are raw schema objects
  expect((all.task as any).properties.done.type).toBe("boolean");

  const taskSchema = (syscalls["index.tagSchema"] as any)({}, "task") as any;
  expect(taskSchema).not.toBeNull();
  expect(taskSchema.properties.done.type).toBe("boolean");

  // undefined tag → null
  expect((syscalls["index.tagSchema"] as any)({}, "nope")).toBeNull();
  // tag without schema → null
  expect((syscalls["index.tagSchema"] as any)({}, "bareTag")).toBeNull();
});
