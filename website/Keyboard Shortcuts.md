SilverBullet uses [CodeMirror](https://codemirror.net) under the hood, which does the majority of the keyboard handling. In addition, it allows to for customization of (most) keys on a per-command basis. When you open the [[Command Palette]], you will see the currently assigned keyboard shortcut(s).

# Modifier keys
Your keyboard shortcut will typically consist of a combination of modifier keys as well as a letter or (special) character or number. The following modifier keys are supported:

* `Alt`
* `Ctrl`
* `Shift`
* `Cmd`: Command key (Mac only)
* `Meta`: usually the “Windows” key
* `Mod`: An alias for `Ctrl` on Linux and Windows, to `Cmd` on Mac

The keyboard shortcut is then combined to e.g. `Mod-Alt-t`.

# Constraints
SilverBullet is constrained in what keyboard can be used in a few ways:
* By the browser: you cannot (usually) override browser keyboard shortcuts, or at least shouldn’t (e.g. `Cmd-t` or `Ctrl-t` for opening a new tab)
* By already used keyboard shortcuts, see [[#Disabling keyboard shortcuts]] below to disable keyboard shortcuts for existing commands.
* By CodeMirror’s restrictions. There a few, here are some we know about:
  * `Alt-letter` is not allowed (e.g. `Alt-a`), because it clashes with various (international) keyboards

# Combos
Generally keyboard shortcuts are single stroke, however it possible to configure them as “combos” (multiple shortcuts entered in sequence). Out of the box, SilverBullet reserves two prefix keys for this “combo” use:

* `Mod-.` (so “command dot” or Mac and “Ctrl dot” on Linux/Windows), used for various [[Outlines]] related commands
* `Ctrl-q` used and reserved for [[Page Template]] use cases
  * `Ctrl-q q` creates a [[^Library/Std/Page Templates/Quick Note]]
  * `Ctrl-q t` runs the `Page: From Template` command
* `Ctrl-g` reserved for navigational commands:
  * `Ctrl-g h` navigates to the index (home) page

# Assigning keyboard shortcuts
Keyboard shortcuts can be assigned to [[Command|Commands]] with `key` or `mac`. If only `key` is defined, this keyboard shortcut will be used for all operating systems, if `mac` is set, this keyboard will be used for macOS.

To (re)assign a keyboard shortcut for an _existing_ command, you can use the [[^Library/Std/APIs/Command#command.update(commandDef)]] API as follows:
```lua
command.update {
  name = "Task: Cycle State",
  key = "Ctrl-Shift-t",
}
```

When you define your own command, you can simply make them part of your command definition:

```lua
command.define {
  name = "My command",
  key = "Ctrl-Shift-t",
  run = function()
    editor.flashNotification "Hello world "
  end
}
```

You can also specify multiple keyboard shortcuts by passing in a table to either `key` or `mac`:

```lua
command.define {
  name = "My command",
  key = {"Ctrl-Shift-t", "Ctrl-Shift-o"},
  run = function()
    editor.flashNotification "Hello world "
  end
}
```

# Disabling keyboard shortcuts
You can use the [[^Library/Std/APIs/Command#command.update(commandDef)]] API to disable keyboard shortcuts of existing commands by setting them to an empty string, for example:

```lua
command.update {
  name = "Task: Cycle State",
  key = "",
  mac = ""
}
```
