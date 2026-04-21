---
description: Manage your space configuration
tags: maturity/beta glossary
---
A built-in UI for editing your space's configuration without having to hand-edit [[Space Lua]] blocks in [[CONFIG]].

# Sections
## Configuration
Lists all configuration options registered via [[API/config#config.define(spec)]], grouped by category. For each option you can edit its value according to its schema — scalars (string, number, boolean), enums (drop-downs), passwords (masked input), and structured objects all have appropriate editors. Defaults come from the schema, so leaving a field untouched means "use the default".

## Keyboard Shortcuts
Lists every [[Command]] in the system and lets you rebind its shortcut. Features:

* A **chord recorder**: click the record button, then press the key combination you want — including multi-stroke chords like `Ctrl-q q`.
* Multiple **alternate bindings** per command.
* Works together with the [[#510]] rework that made almost all built-in editor shortcuts rebindable.

## Libraries
Manages installed [[Library|Libraries]].

# How configuration is store
The Configuration Manager writes your edits into a managed `space-lua` block inside your [[CONFIG]] page, clearly marked. Simple hand edits to the managed block generally survive a round-trip through the UI, but the authoritative format is whatever the Configuration Manager writes.
Anything you add _outside_ that block — in the regular user-configuration block — is left alone.
