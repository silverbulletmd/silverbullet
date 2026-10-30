---
description: "Edit your space's configuration options and key bindings, saved to CONFIG."
references:
- client/workbench/configuration/**
- client/workbench/shared/section_sidebar.tsx
---
The Configuration tab edits your space's configuration without hand-editing [[Space Lua]] in [[CONFIG]]. `Configuration: Open` (`Cmd-,` or `Ctrl-,`) opens the [[Workbench]] on this tab, and `Configuration: Keyboard Shortcuts` opens it on its Key bindings section. On Desktop, *Settings…* in the app menu does the same.

${widgets.commandButton("Workbench: Configuration")} opens this tab in the [[Workbench]].

A sidebar on the left lists two sections. In a narrow panel it becomes a drop-down above the list.

* **Configuration**: every option registered with [[API/config#config.define(key, schema)]] that has a `ui` annotation, grouped by category. The categories are listed under the section in the sidebar; click one to jump to it. Each option shows its label, description and a control that fits its schema: a checkbox, a drop-down, a text, password or number field. Options the tab can't edit say so; change those in [[CONFIG]] directly.
* **Key bindings**: every [[Command]] with its keyboard shortcuts. Click a shortcut, then press the keys you want: chords of several strokes, like `Ctrl-q q`, work too. Enter keeps it, Esc cancels and Backspace undoes the last key. `+` adds an alternate shortcut. A shortcut that's already taken, or that another shortcut would make unreachable, is refused, with the reason shown under the row.

The filter in the toolbar narrows the section showing: options by label, description and path, key bindings by command name.

A dot marks an option or command you changed from its default. Its ⋯ menu offers:

* *Reset to default* (options) or *Reset* (key bindings): drops your override.
* *Copy as Lua* (options): copies the `config.set(…)` line for the current value.
* *Remove binding* and *Run command* (key bindings).

# Saving
Changes stay pending until you click **Save and apply**, or press `Cmd-s`/`Ctrl-s` while the tab has focus. **Discard** drops them. While anything is pending, the tab's label shows a `•`. Pending changes survive switching tabs and closing the Workbench, but not reloading the page.

Saving writes only what you changed into a managed `space-lua` block in [[CONFIG]], then reloads your configuration. Everything outside that block is left alone, and so are values in it that you didn't touch here, such as those [[Share]] remembers. Simple hand edits to the managed block survive a round trip through this tab. If the block isn't valid Lua, the tab shows the error and refuses to save until you fix it in CONFIG.

The footer counts the options or commands, how many you changed, and how many changes are unsaved, and links to CONFIG.

In a read-only space the tab shows the configuration but can't change it.
