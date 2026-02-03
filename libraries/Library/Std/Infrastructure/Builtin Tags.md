---
description: Defines built-in tags.
tags: meta
---
Defined via [[^Library/Std/APIs/Tag]].

```space-lua
local function readOnlyType(type)
  return {
    type = type,
    readOnly = true
  }
end

-- page
tag.define {
  name = "page",
  schema = {
    type = "object",
    additionalProperties = true,
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      tags = {
        anyOf = {
          { type = "array", items = schema.string() },
          schema.string(),
        },
      },
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
        },
        nullable = true,
      },
      displayName = schema.nullable("string"),
      aliases = {
        type = "array",
        items = schema.string(),
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

-- aspiring-page
tag.define {
  name = "aspiring-page",
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

-- document
tag.define {
  name = "document",
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

-- item
tag.define {
  name = "item",
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
      name = readOnlyType("string"),
      page = readOnlyType("string"),
      parent = readOnlyType("string"),
      pos = readOnlyType("string"),
      text = readOnlyType("string"),
    },
  },
}

-- tag
tag.define {
  name = "tag",
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

-- link
tag.define {
  name = "link",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = schema.string(),
      tags = schema.array("string"),
      itags = {
        type = "array",
        items = schema.string(),
        nullable = true,
        readOnly = true,
      },
      name = schema.string(),
      page = schema.string(),
      pageLastModified = schema.string(),
      toFile = schema.nullable("string"),
      toPage = schema.nullable("string"),
      snippet = schema.string(),
      pos = schema.number(),
      alias = schema.string(),
    },
  },
}

-- header
tag.define {
  name = "header",
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
      pos = readOnlyType("number"),
      level = readOnlyType("number"),
    },
  },
}

-- paragraph
tag.define {
  name = "paragraph",
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
      pos = readOnlyType("number"),
    },
  },
}

-- table
tag.define {
  name = "table",
  schema = {
    type = "object",
    properties = {
      ref = readOnlyType("string"),
      tag = readOnlyType("string"),
      page = schema.string(),
      pos = schema.number(),
    },
  },
}

-- task
tag.define {
  name = "task",
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
      pos = readOnlyType("number"),
      text = readOnlyType("string"),
      state = readOnlyType("string"),
      done = readOnlyType("boolean"),
    },
  },
}

-- page templates
tag.define {
  name = "meta/template/page",
  schema = {
    type = "object",
    properties = {
      tags = {
        anyOf = {
          { type = "array", items = schema.string() },
          schema.string(),
        },
      },
      frontmatter = schema.string(),
      suggestedName = schema.string(),
      confirmName = schema.boolean(),
      openIfExists = schema.boolean(),
      command = schema.string(),
      key = {
        anyOf = {
          { type = "array", items = schema.string() },
          schema.string(),
        },
      },
      mac = {
        anyOf = {
          { type = "array", items = schema.string() },
          schema.string(),
        },
      },
      priority = schema.number(),
      description = schema.string(),
    },
  }
}

-- slash templates
tag.define {
  name = "meta/template/slash",
  schema = {
    type = "object",
    properties = {
      tags = {
        anyOf = {
          { type = "array", items = schema.string() },
          schema.string(),
        },
      },
      description = schema.string(),
      priority = schema.number(),
      onlyContexts = schema.array("string"),
      exceptContexts = schema.array("string"),
    },
  }
}
```