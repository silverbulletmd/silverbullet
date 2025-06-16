SilverBullet has a basic Vim mode. You can toggle it using the ${widgets.commandButton("Editor: Toggle Vim Mode")} command.

In addition, it supports various ex commands that you can run as you would expect, for instance: `:imap jj <Esc>`.

The [[CONFIG]] file can also be used to define and extend these commands. It supports the following:

- **Key unmapping** - disable existing keybindings
- **Custom mappings** - using `map` and `noremap`
- **Ex command definitions** - map custom ex commands to built-in or custom SilverBullet commands

To manually reload the `vim` section of your [[CONFIG]], use the ${widgets.commandButton("Editor: Vim: Load Vim Config")} command.

# Configuration
Using Space Lua:

```lua
config.set {
  vim = {
    unmap = {
      "<Space>",
      {
        key = "<C-c>",
        mode = "insert",
      },
    },
    map = {
      {
        map = "jj",
        to = "<Esc>",
        mode = "insert",
      },
    },
    noremap = {
      {
        map = "<",
        to = "<gv",
        mode = "visual",
      },
      {
        map = "<Space>ff",
        to = ":findfile<CR>",
        mode = "normal",
      },
      {
        map = "<Space>rc",
        to = ":runcommand<CR>",
        mode = "normal",
      },
    },
    commands = {
      {
        command = "Navigate: Page Picker",
        ex = "findfile",
      },
      {
        command = "Open Command Palette",
        ex = "runcommand",
      },
    }
  }
}
```
