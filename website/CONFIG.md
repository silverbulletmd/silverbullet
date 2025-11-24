This is where you configure SilverBullet to your liking. See [[^Library/Std/Config]] for a full list of configuration options. 

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
