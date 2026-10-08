#meta

This is where you configure SilverBullet to your liking. See [[^Library/Std/Config]] for a full list of configuration options. 

# Site configuration
```space-lua
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
    o.pageDecoration = { icon = "user" }
    return o
  end
}

-- Architecture Decision Records
tag.define {
  name = "adr",
  tagPage = "ADR",
  schema = {
    type = "object",
    properties = {
      status = {
        type = "string",
        enum = { "proposed", "accepted", "superseded", "deprecated", "rejected" },
        description = "Lifecycle state of the decision."
      },
      date = {
        type = "string",
        description = "Date the decision was made (YYYY-MM-DD)."
      },
      deciders = {
        type = "string",
        description = "Who made the call, a contributor page link, e.g. [[Zef Hemel]]."
      },
      owner = {
        type = "string",
        description = "Who maintains this ADR, a contributor page link, surfaced in [[Health]]."
      },
      lastReviewed = {
        type = "string",
        description = "Date this ADR was last reviewed (YYYY-MM-DD), powers the [[Health]] freshness view."
      },
      supersededBy = {
        anyOf = { schema.array("string"), schema.null() },
        description = "If this decision was superseded, the ADR(s) that replace it (page links). The inverse is a backlink."
      },
      dependsOn = {
        anyOf = { schema.array("string"), schema.null() }, 
        description = "ADRs this decision rests on (page links). The inverse (enabled-by) is a backlink."
      },
      related = {
        anyOf = { schema.array("string"), schema.null() }, 
        description = "Non-directional see-also ADRs (page links)."
      },
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
  end,
  -- Replaces the YAML with a decision card in the editor (click it to edit)
  renderFrontmatter = function(adr)
    local function list(v)
      if type(v) == "string" then return { v } end
      return v or {}
    end
    local function row(parent, label, items)
      if #items == 0 then return end
      parent.appendChild(dom.div {
        class = "adr-row",
        dom.span { class = "adr-label", label },
        dom.span { table.concat(items, " · ") },
      })
    end

    local status = adr.status or "unknown"
    local card = dom.div { class = "adr-card adr-" .. status }

    local meta = dom.div {
      class = "adr-meta",
      dom.span { class = "adr-status", status },
    }
    if adr.date then
      meta.appendChild(dom.span {
        "Decided " .. adr.date .. (adr.deciders and (" by " .. adr.deciders) or ""),
      })
    end
    if adr.owner then
      meta.appendChild(dom.span { "Owner " .. adr.owner })
    end
    local y, m, d = tostring(adr.lastReviewed or ""):match("^(%d+)-(%d+)-(%d+)$")
    if y then
      local reviewed = os.time { year = tonumber(y), month = tonumber(m), day = tonumber(d) }
      local days = math.floor(os.difftime(os.time(), reviewed) / 86400)
      meta.appendChild(dom.span {
        class = days > 180 and "adr-stale" or nil,
        "Reviewed " .. days .. " days ago",
      })
    end
    card.appendChild(meta)

    local supersededBy = list(adr.supersededBy)
    if status == "superseded" and #supersededBy > 0 then
      card.appendChild(dom.div {
        class = "adr-banner",
        "Superseded by " .. table.concat(supersededBy, ", "),
      })
    elseif status == "deprecated" then
      card.appendChild(dom.div {
        class = "adr-banner",
        "Deprecated: kept for history, no longer reflects how SilverBullet works.",
      })
    end

    row(card, "Depends on", list(adr.dependsOn))
    row(card, "Related", list(adr.related))
    return widget.htmlBlock(card)
  end,
}

-- Architecture components
tag.define {
  name = "component",
  tagPage = "Architecture",
  transform = function(o)
    o.pageDecoration = { icon = "box" }
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

# View defaults
```space-lua
config.set("view.defaults", {
  -- The curated Navigate tree (see [[^Library/Website]]) is this site's navigation
  ["docs.navigate"] = { open = true, width = 260 },
})
```

