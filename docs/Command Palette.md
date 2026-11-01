---
description: The searchable popup for running commands.
tags: glossary
references:
- client/navigator/builtins.ts
---
The Command Palette is used to explore SilverBullet’s numerous [[Command]] as well as execute them.

The UI and its operation is largely the same as the [[Page Picker]]‘s, with a few differences:

* If a keyboard shortcut is configured for the given command, it is listed along the command name to the right.
* With an empty filter, commands you have run on this client come first, most recently run first. Other commands are ordered by their configured `priority`, then by name.
* Only commands available in the current context and mode appear. For keyboard shortcuts, use [[Workbench/Configuration|Configuration → Key bindings]]; for command definitions and priority overrides, see [[^Library/Std/APIs/Command]].
