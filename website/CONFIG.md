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
```space-lua
tag.define {
  name = "person",
  transform = function(o)
    o.pageDecoration = { prefix = "🧑 " }
    return o
  end
}

tag.define {
  name = "task",
  transform = function(o)
    local date = o.name:match("📅%s*(%d%d%d%d%-%d%d%-%d%d)")
    if date then
      o.deadline = date
    end
    return o
  end
}
```