---
description: Manage your space configuration
tags: maturity/beta glossary
---
A built-in UI for editing your space's configuration without having to hand-edit [[Space Lua]] blocks in [[CONFIG]].

# Sections
## Configuration
Lists all configuration options registered via [[API/config#config.define(key, schema)]], grouped by category. For each option you can edit its value according to its schema — scalars (string, number, boolean), enums (drop-downs), passwords (masked input), and structured objects all have appropriate editors. Defaults come from the schema, so leaving a field untouched means to use the default.

## Keyboard Shortcuts
Lists every [[Command]] in the system and lets you rebind its shortcut. Features:

* A **chord recorder**: click the record button, then press the key combination you want — including multi-stroke chords like `Ctrl-q q`.
* Multiple **alternate bindings** per command.

## Libraries
Manage installed [[Library|Libraries]].

# How configuration is kept
The Configuration Manager writes your edits into a managed `space-lua` block inside your [[CONFIG]] page. Simple hand edits to the managed block generally survive a round-trip through the UI, but the authoritative format is whatever the Configuration Manager writes.
Anything you add _outside_ that block is left alone.
