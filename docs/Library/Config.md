This is where you configure SilverBullet to your liking. See [[^Library/Std/Config]] for a full list of configuration options. 

# Site configuration
```space-lua
-- boot: true
actionButton.define {
  icon = "message-circle",
  description = "Community",
  priority = 2.7,
  run = function()
    editor.openUrl "https://community.silverbullet.md"
  end
}

actionButton.define {
  icon = "github",
  description = "Github",
  priority = 2.6,
  run = function()
    editor.openUrl "https://github.com/silverbulletmd/silverbullet"
  end
}
```

# Custom tag definitions
(further detailed in [[API/tag#Use cases]])
```space-lua
-- boot: true
tag.define {
  name = "glossary",
  schema = {
    type = "object",
    properties = {
      description = { type = "string" },
    },
    required = { "description" },
  },
}

tag.define {
  name = "person",
  pageDecoration = { icon = "user" },
}

-- Architecture Decision Records
local function described(s, description)
  s.description = description
  return s
end

local function adrLinks(description)
  return described(schema.nullable(schema.array(schema.ref("adr"))), description)
end

tag.define {
  name = "adr",
  tagPage = "ADR",
  schema = {
    type = "object",
    properties = {
      status = described(
        schema.enum { "proposed", "accepted", "superseded", "deprecated", "rejected" },
        "Lifecycle state of the decision."),
      date = described(schema.date(), "Date the decision was made."),
      deciders = described(schema.ref("contributor"),
        "Who made the call, e.g. [[Zef Hemel]]."),
      owner = described(schema.ref("contributor"),
        "Who maintains this ADR, surfaced in [[Health]]."),
      lastReviewed = described(schema.date(),
        "Date this ADR was last reviewed, powers the [[Health]] freshness view."),
      supersededBy = adrLinks("If superseded, the ADR(s) that replace it. The inverse is a backlink."),
      dependsOn = adrLinks("ADRs this decision rests on. The inverse (enabled-by) is a backlink."),
      related = adrLinks("Non-directional see-also ADRs."),
      references = described(schema.nullable(schema.array("string")),
        "Source files (repo-relative paths) that implement this decision."),
    },
    required = { "status", "date", "owner" },
  },
  transform = function(o)
    local dot = ({
      proposed = "🟡",
      accepted = "🟢",
      superseded = "⚪",
      deprecated = "🟠",
      rejected = "🔴",
    })[o.status] or "📐"
    o.pageDecoration = { prefix = dot .. " " }
    return o
  end,
}

-- Architecture components
tag.define {
  name = "component",
  tagPage = "Architecture",
  pageDecoration = { icon = "box" },
}

-- Theming reference data (Theming/Variables/Data, Theming/Selectors). Keep the
-- enums in step with client/styles/theme_docs.test.ts, which checks the same.
local themeStability = {
  type = "string",
  enum = { "stable", "experimental", "deprecated" },
}

tag.define {
  name = "theme-variable",
  tagPage = "Theming/Variables",
  icon = "droplet",
  schema = {
    type = "object",
    properties = {
      name = { type = "string", pattern = "^--[a-z0-9-]+$" },
      group = { type = "string" },
      level = { type = "string", enum = { "base", "specific" } },
      light = { type = "string" },
      dark = { type = "string" },
      derivesFrom = {
        type = "array",
        items = { type = "string", pattern = "^--[a-z0-9-]+$" },
      },
      since = { type = "string" },
      stability = themeStability,
      description = { type = "string", minLength = 1 },
    },
    required = { "name", "group", "level", "since", "stability", "description" },
  },
}

tag.define {
  name = "theme-selector",
  tagPage = "Theming/Selectors",
  icon = "crosshair",
  schema = {
    type = "object",
    properties = {
      selector = { type = "string" },
      description = { type = "string", minLength = 1 },
      since = { type = "string" },
      stability = themeStability,
    },
    required = { "selector", "description", "since", "stability" },
  },
}

local deadlinePattern = "📅%s*(%d%d%d%d%-%d%d%-%d%d)"

tag.define {
  name = "task",
  validate = function(o)
    if o.name:find("📅") then
      if not o.name:match(deadlinePattern) then
        return "Found 📅, but did not match YYYY-mm-dd format"
      end
    end
  end,
  transform = function(o)
    -- Use a regular expression to find a deadline
    local date = o.name:match(deadlinePattern)
    if date then
      -- Remove the deadline from the name
      o.name = o.name:gsub(deadlinePattern, "")
      -- And put it in as attribute
      o.deadline = date
    end
    return o
  end
}
```

# View defaults
```space-lua
-- boot: true
config.set("view.defaults", {
  -- The curated Navigate tree (see [[^Library/Website]]) is this site's navigation
  ["docs.navigate"] = { open = true, width = 360 },
})
```

# Lint
```space-lua
-- Documentation pages hold space-lua and space-style examples on purpose
config.set("lint.inactiveBlocks", false)
```


```space-lua
-- managed-by: configuration-manager
-- boot: true
config.set("workbench.pinnedTags", {
  "page",
  "task",
})
config.set("accentColor", "#0059b8")
```

```space-lua
-- managed-by: workbench-schemas
-- boot: true
-- priority: -10
tag.define {
  name = "api/lua",
  schema = {
    type = "object",
    properties = {references = schema.array "string"},
    required = {"references"},
  },
}
tag.define {
  name = "component",
  schema = {
    type = "object",
    properties = {
      connectsTo = {anyOf = {
        schema.array "string",
        schema.ref(),
      }},
      partOf = schema.ref(),
      consumes = schema.ref(),
    },
  },
}
```
