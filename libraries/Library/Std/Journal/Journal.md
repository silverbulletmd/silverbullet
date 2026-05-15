#meta

This page implements the built-in daily journal feature: four commands (`Journal: Today`, `Journal: Previous Day`, `Journal: Next Day`, `Journal: Picker`) and a default template at [[^Library/Std/Journal/Template]].

# Configuration
The journal feature can be configured via the `journal` config key:

* `journal.enabled` — set to `false` to disable all journal commands.
* `journal.template` — page name to use as the template (defaults to `Library/Std/Journal/Template`).
* `journal.prefix` — page-name prefix for new journal entries (defaults to `Journal/`). Must end with a `/` if you want entries grouped under a folder.
* `journal.tag` — tag used to mark journal pages (defaults to `journal`). The template, Prev/Next commands, and the default index page all key off this tag.

# Configuration
The schema, helpers, and command definitions live in two fenced blocks. The first (`priority: 10`) registers the config schema and defines helpers attached to the `journal` namespace. The second (`priority: -1`) runs after user CONFIG has loaded, so `config.get("journal.enabled")` reflects the user's override.

```space-lua
-- priority: 10
journal = journal or {}

config.defineCategory {
  name = "Journal",
  description = "Configure the built-in daily journal feature.",
  priority = 15,
}

config.define("journal", {
  description = "Configure the built-in journal feature",
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      default = true,
      description = "Enable the built-in Journal commands",
      ui = { category = "Journal", label = "Enable journal", priority = 4 },
    },
    template = {
      type = "string",
      default = "Library/Std/Journal/Template",
      description = "Page name to use as the template for new journal entries",
      ui = { category = "Journal", label = "Journal template page", priority = 3 },
    },
    prefix = {
      type = "string",
      default = "Journal/",
      description = "Page-name prefix for new journal entries (e.g. 'Journal/' yields 'Journal/2026-05-12'). Must end with '/' to group under a folder.",
      ui = { category = "Journal", label = "Journal page prefix", priority = 2 },
    },
    tag = {
      type = "string",
      default = "journal",
      description = "Tag used to mark journal pages. Prev/Next and the index-page section both key off this tag.",
      ui = { category = "Journal", label = "Journal tag", priority = 1 },
    },
  },
  additionalProperties = false,
})
```

# API

```space-lua
function journal.openOrCreate(dateStr)
  local pageName = config.get("journal.prefix") .. dateStr
  if space.pageExists(pageName) then
    editor.navigate(pageName)
    return
  end
  local templatePage = config.get("journal.template")
  template.createPageFromTemplate(templatePage, pageName, true)
end

function journal.entries()
  local tagName = config.get("journal.tag")
  return query[[
    from j = index.tag(tagName)
    where j.tag == "page"
    order by j.date desc
  ]]
end

function journal.neighbor(direction)
  local entries = journal.entries()
  if #entries == 0 then return nil end
  local currentPage = editor.getCurrentPage()
  local pivot = date.today()
  for _, e in ipairs(entries) do
    if e.name == currentPage and e.date then
      pivot = e.date
      break
    end
  end
  if direction == "previous" then
    for _, e in ipairs(entries) do
      if e.date and e.date < pivot then
        return e
      end
    end
  else
    local result
    for _, e in ipairs(entries) do
      if e.date and e.date > pivot then
        result = e
      end
    end
    return result
  end
  return nil
end
```

# Commands
```space-lua
-- priority: -1
if config.get("journal.enabled", true) then
  -- using command.update here (instead of command.define) to support key binding overrides (executed before)
  command.update {
    name = "Journal: Today",
    key = "Ctrl-q j",
    run = function()
      journal.openOrCreate(date.today())
    end,
  }
  command.update {
    name = "Journal: Previous Day",
    key = "Ctrl-q p",
    run = function()
      local entry = journal.neighbor("previous")
      if entry then
        editor.navigate(entry.name)
      else
        editor.flashNotification("No earlier journal entries")
      end
    end,
  }
  command.update {
    name = "Journal: Next Day",
    key = "Ctrl-q n",
    run = function()
      local entry = journal.neighbor("next")
      if entry then
        editor.navigate(entry.name)
      else
        editor.flashNotification("No later journal entries")
      end
    end,
  }
  command.update {
    name = "Journal: Picker",
    run = function()
      local entries = journal.entries()
      if #entries == 0 then
        editor.flashNotification("No journal entries yet")
        return
      end
      local prefix = config.get("journal.prefix")
      local items = {}
      for _, e in ipairs(entries) do
        local label = e.name
        if prefix ~= "" and label:startsWith(prefix) then
          label = label:sub(#prefix + 1)
        end
        table.insert(items, { name = label, fullName = e.name })
      end
      local selected = editor.filterBox("Journal entry", items, "Pick a journal entry to open")
      if not selected then return end
      editor.navigate(selected.fullName)
    end,
  }
end
```
