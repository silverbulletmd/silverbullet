---
description: "Find broken links, script failures, merge conflicts and space-wide lint errors."
references:
- client/workbench/health/**
---
The Health tab lists (potential) problems in your space in one place.

${widgets.commandButton("Workbench: Health")} opens this tab in the [[Workbench]].

The checks below are instant, and refresh as your space changes:
* **Broken links:** links to pages that don't exist yet ([[Tag/aspiring-page|aspiring pages]]).
* **Ambiguous links:** links that could mean more than one page (see [[Link#Ambiguous links]]).
* **Scripts and styles:** scripts that failed to load or are quarantined, and styles that hold CSS the browser parsed no rules from.
* **Merge conflicts:** unresolved merges that need your decision.

# Space-wide lint
The space-wide lint runs [[API/space#space.lint]] over every page. This reads each page, runs every lint rule and renders its `${…}` expressions and Lua widgets, so on a large space it can take a while. That’s why it never runs by itself: press **Run space-wide lint** when you want it.
