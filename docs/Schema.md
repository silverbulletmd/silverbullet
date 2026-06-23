---
description: A definition that validates and constrains the shape of object attributes.
tags: glossary
---

SilverBullet uses [JSON Schema](https://json-schema.org) for validation of structured data. Schemas ensure that [[Frontmatter]] attributes, [[Tag#Custom tags|custom tag]] fields, and configuration options conform to expected types and shapes.

# Where schemas are used
## Custom tag definitions
When you define a custom tag with `tag.define`, you can provide a schema that describes the expected attributes. SilverBullet validates objects against this schema and surfaces errors in the editor:

```lua
tag.define {
  name = "contact",
  schema = {
    type = "object",
    properties = {
      email = schema.string(),
      phone = schema.nullable("string"),
      priority = schema.number(),
    }
  }
}
```

Pages or objects tagged with `#contact` will be validated against this schema — if a field has the wrong type, you'll see a lint warning in the editor.

## Configuration definitions
The `config.define` function uses schemas to validate configuration values:

```lua
config.define("myLibrary.config", {
  type = "object",
  properties = {
    enabled = schema.boolean(),
    maxItems = schema.number(),
  }
})
```

This ensures that `config.set("myLibrary.config", ...)` only accepts values matching the schema.

# Schema helper functions
The [[^Library/Std/APIs/Schema]] library provides convenience functions like `schema.string()`, `schema.number()`, `schema.array(typ)`, etc. for building JSON Schema objects in Lua. See the API page for the full list.

# How validation surfaces
When schema validation fails for page and attributes, SilverBullet shows the error as a lint warning in the editor. 

See also: [[Tag#Custom tags]], [[API/jsonschema]], [[API/config]]
