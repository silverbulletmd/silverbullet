---
description: Defines the schemas of root tags.
---
Defined via [[^Library/Std/APIs/Tag]].

```space-lua
-- priority: 10
local function readOnlyType(type)
  return {
    type = type,
    readOnly = true
  }
end

local rangeType = {
  type = "array",
  items = { schema.number(), schema.number() },
  minItems = 2,
  maxItems = 2,
}

tag.define {
  name = "page",
  icon = "file-text",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.tags(),
      -- range of where fronmatter appears in the page (if present)
      range = rangeType,
      itags = {
        type = "array",
        readOnly = true,
        items = schema.string(),
        nullable = true,
      },
      name = schema.string(),
      pageDecoration = {
        type = "object",
        properties = {
          prefix = schema.nullable("string"),
          cssClasses = {
            type = "array",
            items = schema.string(),
            nullable = true,
          },
          hide = schema.nullable("boolean"),
          renderWidgets = schema.nullable("boolean"),
          icon = schema.nullable("string"),
          tree = {
            type = "object",
            properties = {
              priority = schema.nullable("number"),
              hide = schema.nullable("boolean"),
            },
            nullable = true,
          },
        },
        nullable = true,
      },
      displayName = schema.nullable("string"),
      aliases = {
        type = "array",
        items = schema.string(),
        nullable = true,
      },
      recipients = schema.identities {
        description = "Who this page is for, by @name",
        nullable = true,
      },
      authors = schema.identities {
        description = "Who wrote this page, by @name.",
        nullable = true,
      },
      created = readOnlyType("string"),
      contentType = readOnlyType("string"),
      size = readOnlyType("number"),
      lastModified = readOnlyType("string"),
      perm = {
        type = "string",
        readOnly = true,
        enum = { "ro", "rw" },
      },
      lastOpened = readOnlyType("number"),
    },
  },
}

tag.define {
  name = "aspiring-page",
  icon = "file-plus",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      name = readOnlyType("string"),
      page = readOnlyType("string"),
      pos = readOnlyType("number"),
    },
  },
}

tag.define {
  name = "document",
  icon = "file",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = {
        type = "array",
        readOnly = true,
        items = schema.string(),
        nullable = true,
      },
      itags = {
        type = "array",
        readOnly = true,
        items = schema.string(),
        nullable = true,
      },
      name = readOnlyType("string"),
      created = readOnlyType("string"),
      contentType = readOnlyType("string"),
      size = readOnlyType("number"),
      lastModified = readOnlyType("string"),
      perm = readOnlyType("string"),
      extension = readOnlyType("string"),
    },
  },
}

tag.define {
  name = "item",
  icon = "list",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        readOnly = true,
        items = schema.string(),
        nullable = true,
      },
      page = readOnlyType("string"),
      name = readOnlyType("string"),
      text = readOnlyType("string"),
      parent = readOnlyType("string"),
      pageLastModified = readOnlyType("string"),
      range = rangeType,
      -- deprecated in favor of range
      pos = readOnlyType("number"),
    },
  },
}

tag.define {
  name = "tag",
  icon = "tag",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        readOnly = true,
        items = schema.string(),
        nullable = true,
      },
      name = readOnlyType("string"),
      page = readOnlyType("string"),
      parent = readOnlyType("string"),
      context = readOnlyType("string"),
    },
  },
}

-- Deprecated: a view over relation records, kept for compatibility
tag.define {
  name = "link",
  icon = "link",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = schema.string(),
      -- type of link: page, file, url
      type = schema.string(),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        nullable = true,
        readOnly = true,
      },
      name = schema.string(),
      page = schema.string(),
      alias = schema.string(),
      pageLastModified = schema.string(),
      toFile = schema.nullable("string"),
      toPage = schema.nullable("string"),
      toURL = schema.nullable("string"),
      snippet = schema.string(),
      range = rangeType,
      -- deprecated in favor of range
      pos = schema.number(),
    },
  },
}

tag.define {
  name = "relation",
  icon = "share-2",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        nullable = true,
        readOnly = true,
      },
      -- Either a reserved structural value ("mention", "co-mention") or a
      -- user predicate (e.g. "spouse") taken from an attribute/frontmatter/
      -- data-block key. Open-ended, so no enum.
      kind = readOnlyType("string"),
      from = readOnlyType("string"),
      fromTag = schema.nullable("string"),
      to = readOnlyType("string"),
      toTag = schema.nullable("string"),
      via = schema.nullable("string"),
      alias = schema.nullable("string"),
      snippet = schema.nullable("string"),
      page = readOnlyType("string"),
      range = rangeType,
      pageLastModified = readOnlyType("string"),
    },
  },
}

tag.define {
  name = "header",
  icon = "hash",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        nullable = true,
      },
      name = readOnlyType("string"),
      page = readOnlyType("string"),
      range = rangeType,
      level = readOnlyType("number"),
      -- deprecated in favor of range
      pos = readOnlyType("number"),
    },
  },
}

tag.define {
  name = "paragraph",
  icon = "align-left",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        readOnly = true,
        nullable = true,
      },
      text = readOnlyType("string"),
      page = readOnlyType("string"),
      range = rangeType,
      -- deprecated in favor of range
      pos = readOnlyType("number"),
    },
  },
}

tag.define {
  name = "table",
  icon = "grid",
  schema = {
    type = "object",
    -- One property per column
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        readOnly = true,
        nullable = true,
      },
      page = schema.string(),
      range = rangeType,
      -- deprecated in favor of range
      pos = schema.number(),
    },
  },
}

tag.define {
  name = "data",
  icon = "database",
  schema = {
    type = "object",
    -- One property per YAML key
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.tags(),
      -- An anchor name: the object's ref, so [[$name]] links to it
      ["$ref"] = {
        type = "string",
        description = "Anchor name, so [[$name]] links to this object",
      },
      itags = {
        type = "array",
        items = schema.string(),
        readOnly = true,
        nullable = true,
      },
      page = readOnlyType("string"),
      range = rangeType,
      -- deprecated in favor of range
      pos = readOnlyType("number"),
    },
  },
}

tag.define {
  name = "space-lua",
  icon = "code",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      range = rangeType,
      script = readOnlyType("string"),
      priority = schema.nullable("number"),
    },
  },
}

tag.define {
  name = "space-style",
  icon = "droplet",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      range = rangeType,
      style = readOnlyType("string"),
      priority = schema.nullable("number"),
    },
  },
}

tag.define {
  name = "ambiguous-link",
  icon = "help-circle",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      page = readOnlyType("string"),
      range = rangeType,
      -- deprecated in favor of range
      pos = readOnlyType("number"),
      -- The link target as written
      name = readOnlyType("string"),
      resolvesTo = readOnlyType("string"),
      candidates = schema.array("string"),
    },
  },
}

tag.define {
  name = "identity",
  icon = "at-sign",
  schema = {
    type = "object",
    properties = {
      -- The namespaced @name identifier
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      name = readOnlyType("string"),
      page = readOnlyType("string"),
    },
  },
}

tag.define {
  name = "anchor",
  icon = "anchor",
  schema = {
    type = "object",
    properties = {
      -- The anchor name itself (e.g. "tsk1" for $tsk1).
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      -- The page on which the anchor was defined.
      page = readOnlyType("string"),
      -- The root tag of the object the anchor attaches to
      hostTag = readOnlyType("string"),
    },
  },
}

tag.define {
  name = "task",
  icon = "check-square",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        readOnly = true,
        nullable = true,
      },
      name = readOnlyType("string"),
      page = readOnlyType("string"),
      parent = readOnlyType("string"),
      range = rangeType,
      -- deprecated in favor of range
      pos = readOnlyType("number"),
      text = readOnlyType("string"),
      state = readOnlyType("string"),
      done = readOnlyType("boolean"),
      pageLastModified = readOnlyType("string"),
    },
  },
}

tag.define {
  name = "meta/library/remote",
  schema = {
    type = "object",
    properties = {
      name = schema.string(),
      author = schema.string(),
      description = schema.string(),
      uri = {
        type = "string",
        format = "uri",
      },
      website = {
        type = "string",
        format = "uri",
      },
      -- What the library requires, as its page lists it (shown before install)
      requires = { type = "array", items = schema.string() },
    },
    required = {
      "name",
      "uri",
    },
  },
}
tag.define {
  name = "meta/library",
  schema = {
    type = "object",
    properties = {
      files = schema.array("string"),
      share = schema.object(),
      description = schema.string(),
      -- Libraries to install first: share URIs, or paths relative to this one's
      requires = { type = "array", items = schema.string() },
    },
  },
}

-- A theme page (see Theming); mirrors what plug-api/lib/themes.ts reads
tag.define {
  name = "meta/theme",
  icon = "droplet",
  schema = {
    type = "object",
    properties = {
      scheme = { type = "string", enum = { "light", "dark" } },
      displayName = schema.string(),
      description = schema.string(),
      counterpart = schema.string(),
      fonts = {
        type = "object",
        properties = {
          ui = schema.string(),
          editor = schema.string(),
          code = schema.string(),
          editorSize = { type = "number", minimum = 10, maximum = 48 },
        },
      },
    },
    required = { "scheme" },
  },
}

```
