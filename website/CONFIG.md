This is where you configure SilverBullet to your liking. See [[^Library/Std/Config]] for a full list of configuration options. 

# Main configuration
```space-lua
config.set {
  actionButtons = {
    {
      icon = "home",
      description = "Go to the index page",
      run = function()
        editor.invokeCommand("Navigate: Home")
      end
    },
    {
      icon = "activity",
      description = "What's new",
      run = function()
        editor.navigate "CHANGELOG"
      end
    },
    {
      icon = "message-circle",
      description = "Community",
      run = function()
        editor.openUrl "https://community.silverbullet.md"
      end
    },
    {
      icon = "github",
      description = "Github",
      run = function()
        editor.openUrl "https://github.com/silverbulletmd/silverbullet"
      end
    },
    {
      icon = "heart",
      description = "Funding",
      run = function()
        editor.navigate "Funding"
      end
    },
    {
      icon = "book",
      description = "Open page",
      run = function()
        editor.invokeCommand("Navigate: Page Picker")
      end
    },
    {
      icon = "search",
      description = "Search",
      run = function()
        editor.invokeCommand("Silversearch: Search")
      end
    },
    {
      icon = "terminal",
      description = "Run command",
      run = function()
        editor.invokeCommand "Open Command Palette"
      end,
    }
  }
}
```

# Custom tag definitions
(further detailed in [[API/tag#Use cases]])
```space-lua
tag.define {
  name = "person",
  transform = function(o)
    o.pageDecoration = { prefix = "🧑 " }
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