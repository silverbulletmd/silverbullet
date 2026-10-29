---
tags: api/space-lua
references:
- libraries/Library/Std/Widgets/Widgets.md
---
Ready-made buttons and sub-page lists. Use them in a [[Space Lua#Expressions|`${...}` expression]] or return them from a [[API/widget#Content functions|widget's `content` function]]. They are built with the [[API/dom|DOM builder]] and implemented in [[^Library/Std/Widgets/Widgets]].

For chips, bars, number cards and responsive grids, install the [Dashboard library](https://github.com/silverbulletmd/silverbullet-libraries/blob/main/Library/silverbulletmd/Dashboard.md) through [[Workbench/Libraries|Workbench → Libraries]]. These helpers are distributed separately from core.

# API
## widgets.button(text, callback, attrs?)
A button that runs `callback` when clicked. `text` is shown literally. `attrs` adds attributes to the `<button>` element (see [[API/dom]]).

${widgets.button("Say hi", function()
  editor.flashNotification "Hi there!"
end)}

## widgets.commandButton(commandName) / widgets.commandButton(text, commandName, args?)
A button that runs a [[Command|command]]. With one argument, the command name is also the label; `args` is a list of arguments passed to the command.

${widgets.commandButton("Reload", "System: Reload")}

## widgets.subPages(pageName?)
A list of the pages below `pageName` (default: the current page).

## Input widgets
`widgets.textInput`, `numberInput`, `booleanInput`, `dateInput`, `selectInput`, `listInput`, `chipsInput`, `tagsInput`, `identitiesInput`, `refInput`, `refListInput`, `schemaInput`, `menu` and `openMenu` (opens a `menu` node from the keyboard) are form controls for your own widgets and forms; `widgets.inputFormats` registers inputs for custom formats. They are documented in [[^Library/Std/Widgets/Inputs]].
