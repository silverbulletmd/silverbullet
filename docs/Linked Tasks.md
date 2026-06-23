---
description: Tasks that reference a specific page using a link.
tags: glossary
---

It is a common SilverBullet pattern to give people, groups of people and places dedicated pages so you can easily reference them. It then becomes very convenient to mention these pages elsewhere in your space, and using [[Linked Mention]] you can easily find what _pages_ link back to that page.

The equivalent of this idea in the context of [[Task]] is Linked Tasks. These are tasks that _mention_ a particular page.

# Example workflow
Let's say you keep notes of 1-on-1 meetings with people. You have a page for each person where you keep notes for each of your sessions. As you talk to person _A_, something comes up that you need to discuss with person _B_. B _also_ has their own page. What you can do is simply create a task on your note page with _A_ (so you don't have to context switch) that includes a [[Link|link]] to _B_.

The next time you open B's page, you'll see the task from your meeting with A listed in the "Linked Tasks" widget at the top.

# Behind the scenes
The Linked Tasks widget appears at the top of a page and shows all incomplete tasks from _other_ pages that contain a link to the current page. This is powered by a query that finds tasks where `ilinks` (inherited links) includes the current page name.

When you complete a linked task (by checking the checkbox), the task is updated on its source page — the state change propagates across pages.

# Configuration
You can enable or disable the Linked Tasks widget via configuration:

```lua
-- Disable linked tasks widget
config.set("std.widgets.linkedTasks.enabled", false)
```

# Example
Below are two tasks that mention this very page (this is not the general pattern, just for demonstration purposes). Note that the not completed task is listed at the top of this page as well in the "Linked Tasks" widget.

* [ ] [[Linked Tasks]] This is a task
* [x] [[Linked Tasks]] This is a completed task

**Implementation:** [[^Library/Std/Widgets/Widgets]]
