This is where you configure SilverBullet to your liking. See [[^Library/Std/Config]] for a full list of configuration options.

```space-lua
config.set {
  plugs = {
    "github:joekrill/silverbullet-treeview/treeview.plug.js"
  },
  actionButtons = {
    {
      icon = "home",
      command = "Navigate: Home",
      description = "Go to the index page"
    },
    {
      icon = "activity",
      description = "What's new",
      command = "Navigate: To Page",
      args = {"CHANGELOG"}
    },
    {
      icon = "message-circle",
      description = "Community",
      command = "Navigate: To URL",
      args = {"https://community.silverbullet.md"}
    },
    {
      icon = "book",
      command = "Navigate: Page Picker",
      description = "Open page"
    },
    {
      icon = "terminal",
      command = "Open Command Palette",
      description = "Run command"
    }
  },
  smartQuotes = {
    enabled = true,
  },
  shortcuts = {
    {
      command = "Stats: Show",
      key = "Ctrl-Shift-s",
      slashCommand = "stats"
    }
  },
  queryCollate = {
    enabled = true,
    locale = "en",
    options = {
      caseFirst = "upper"
    }
  }
}
```
