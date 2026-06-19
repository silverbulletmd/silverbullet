#meta

This is where you configure SilverBullet to your liking. See [[^Library/Std/Config]] for a full list of configuration options. 

# Site configuration
```space-lua
actionButton.define {
  icon = "activity",
  description = "What's new",
  priority = 2.8,
  run = function()
    editor.navigate "CHANGELOG"
  end
}

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

actionButton.define {
  icon = "heart",
  description = "Funding",
  priority = 2.5,
  run = function()
    editor.navigate "Funding"
  end
}

actionButton.define {
  icon = "search",
  description = "Search",
  priority = 1.5,
  run = function()
    editor.invokeCommand("Silversearch: Search")
  end
}
```

# Custom tag definitions
(further detailed in [[API/tag#Use cases]])
```space-lua
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
  transform = function(o)
    o.pageDecoration = { prefix = "🧑 " }
    return o
  end
}

-- Architecture Decision Records. Schema validates frontmatter (and drives
-- autocompletion); the transform shows a status-colored dot as a page prefix.
tag.define {
  name = "adr",
  tagPage = "ADR",
  schema = {
    type = "object",
    properties = {
      status = { type = "string", enum = { "proposed", "accepted", "superseded", "deprecated", "rejected" }, description = "Lifecycle state of the decision." },
      date = { type = "string", description = "Date the decision was made (YYYY-MM-DD)." },
      deciders = { type = "string", description = "Who made the call — a contributor page link, e.g. [[Zef Hemel]]." },
      owner = { type = "string", description = "Who maintains this ADR — a contributor page link, surfaced in [[Health]]." },
      lastReviewed = { type = "string", description = "Date this ADR was last reviewed (YYYY-MM-DD), powers the [[Health]] freshness view." },
      supersededBy = { anyOf = { schema.array("string"), schema.null() }, description = "If this decision was superseded, the ADR(s) that replace it (page links). The inverse is a backlink." },
      dependsOn = { anyOf = { schema.array("string"), schema.null() }, description = "ADRs this decision rests on (page links). The inverse (enabled-by) is a backlink." },
      related = { anyOf = { schema.array("string"), schema.null() }, description = "Non-directional see-also ADRs (page links)." },
    },
    required = { "status" },
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
  end
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

