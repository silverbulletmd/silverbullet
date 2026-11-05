---
description: "The Space Lua and Space Style blocks of your space: load order, errors and parsed rules."
references:
- client/workbench/code/**
- client/workbench/scripts/**
- client/workbench/styles/**
---
The Code tab shows the code in your space, in two sections picked from the sidebar, each with its number of blocks:

* [[Workbench/Code/Scripts|Space Lua]]: every `space-lua` block, in the order SilverBullet loads them, and how loading each one went.
* [[Workbench/Code/Styles|Space Style]]: every `space-style` block, in the order they're applied, and how many CSS rules the browser parsed from each.

${widgets.commandButton("Workbench: Scripts")} and ${widgets.commandButton("Workbench: Styles")} open the [[Workbench]] on either section. In a narrow dock, the sidebar becomes a picker above the section.
