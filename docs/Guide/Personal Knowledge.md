---
tags: guide
---
Keep ideas, reading notes, plans and tasks in a space you can search and link. This guide uses Sam Rivera, a fictional photographer and birdwatcher, to show how a few topic pages can grow into a personal knowledge base.

You need a writable space. [[Install/Desktop|Install Desktop]] and create a local space, or use a space on [[Install|SilverBullet Server]]. Desktop can work entirely on your computer; an external Server is optional. Try the examples in your own space, since this documentation is read-only.

# Start with something you want to remember
Open the [[Page Picker]] with Cmd-k / Ctrl-k, type `Photo Walk`, and press Shift-Enter to open that exact page name. If you already used this practice page in another guide, keep that content rather than pasting a second copy. Otherwise write:

```markdown
Sam Rivera is planning a photo walk on 2026-06-14.

# Plan
* Meet at the riverside path at 08:00.

# Pack
* [ ] Charge camera battery
* [ ] Pack binoculars
* [x] Check the weather

After the walk, choose a book from [[Reading List]].
```

SilverBullet saves edits automatically. Let the save indicator in the [[Top Bar]] settle before closing the app.

Follow the `Reading List` link and add a few titles. When you return to `Photo Walk`, you still have the plan and its tasks together. [[Guide/Your First Markdown Page]] explains headings, bullets and checkboxes if those are unfamiliar.

# Connect observations to their subjects
Open the command palette with **Cmd-/** on macOS or **Ctrl-/** on Windows/Linux and run `Journal: Today` and write a short observation with a link to `[[Photo Walk]]`. Open `Photo Walk` and inspect its [[Linked Mention|linked mentions]] to find the journal entry again. You can also write directly on topic pages; a daily journal is optional.

Use the page picker when you remember a title, and [[Search]] when you remember a phrase. [[Guide/Find Pages]] covers both. As links accumulate, [[Graph View]] can help you explore how your topics connect.

# Add attributes when you have a reason
A short reading list can stay a list. When you want to find every book you are currently reading, give each book its own page. Hover near the top of the page, use **Add tag** to add `book`, then expand the attribute form and use **+ add attribute** to add an `author` and a `status` such as `reading`.

[[Guide/Organize with Tags and Attributes]] shows this visual workflow and the Markdown stored underneath. You do not need a data model before you start writing; add fields when you want to compare or retrieve their values.

# Bring scattered information together
Open `Workbench: Query` to explore your books or tasks, choose filters and preview the result. Insert a useful query into a reading overview or your home page. [[Guide/Build Your First Query]] supplies a complete task example; [[Guide/Knowledge Base]] applies the same workflow to books.

Keep the original tasks on the pages where they make sense. [[Guide/Task Management]] shows how to collect them into focused lists, and [[Guide/When Results Update]] explains when edits reach those lists.

# Keep your space available
Keep a separate backup; [[Guide/Storage and Recovery]] explains what page history can recover and what it cannot. If you want your local Desktop space on another device, review [[Desktop Sync]] for optional synchronization with a Server. Browser offline support is a separate feature documented under [[Sync]].

For a fuller example of Sam’s space, see [Personal knowledge on silverbullet.md](https://silverbullet.md/personal).
