---
description: "Space statistics, activity, Git sync and runtime state in the Workbench."
references:
- client/workbench/overview/**
---
The Overview tab shows your space at a glance.

${widgets.commandButton("Workbench: Overview")} opens this tab in the [[Workbench]].

It shows:

* **Pages:** how many pages you have, with how many were created this month.
* **Tasks:** open and done tasks.
* **Top tags:** the [[Tag|tags]] used on the most pages.
* **Links:** the number of links and mentions, in other words all [[Tag/relation|relations]] in your space.
* **Documents:** how many non-page [[Document|documents]] you have, and their total size.
* **Activity:** a heatmap of your edits over the last 20 weeks, and the number of edits in the last 7 days.
* **Most edited in the last month:** the pages you edited most over the last 30 days that still exist.
* **Edits by person:** who made the edits of the last month, with a count for each. It only shows when more than one person edits the space.
* **Git sync:** the state of Git sync, when it is enabled: "Sync failed", "Paused", "Syncing…" or the number of conflicted files when sync isn't idle, otherwise the number of pending changes or "Up to date".
* **Runtime:** the SilverBullet version, and how many scripts and styles are loaded. Scripts and styles link to their tabs.