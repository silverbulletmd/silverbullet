---
tags: guide
---
Keep tasks where they arise, link them to their subject, and use focused lists to see what remains.

# Write tasks where they belong
Add a task to the page where its context is described. Type `* [ ]` followed by the task text, or use `/task` on a line. Click its checkbox to complete it. [[Task]] explains task states and editing commands.

A page’s status is separate from task completion. Completing every task does not automatically change an attribute on the containing page.

# Add task attributes
Use inline tags and attributes to categorize individual tasks or record values you want to filter and sort by. For example, `[priority: high]` on a task gives that task a priority attribute.

Every task already has the built-in `task` tag. Page tags and attributes describe the page. Use task-level fields when the value belongs to an individual action. See [[Attribute]], [[Markdown/Hashtags#Scope rules]] and [[Tag/task]] for syntax and available fields.

# Connect tasks to their subject
Include a page link in a task when it concerns another page. The **Linked Tasks** view on the destination page collects incomplete tasks from other pages that link to it. It does not duplicate tasks already on the current page. Run `Navigate: Linked Tasks` if you need to show the view.

Checking a linked task completes the original task on its source page. [[Linked Tasks]] explains inherited links and the view’s behavior. [[Linked Mention|Linked Mentions]] shows other references to the page as well.

# Build a task overview
Place the cursor where you want the list and run **Workbench: Data**.

1. Choose `task` as the source.
2. Filter `done` **is false** to show unfinished tasks.
3. Add filters for the pages, tags or attributes you want to include.
4. Choose an order and, if useful, a result limit.
5. Under **Select**, choose **List → templates.taskItem** to show task checkboxes.
6. Use **Insert at cursor** to keep the query on your page.

To list tasks by a date attribute, filter that attribute with **exists** and sort it with the earliest date first. This includes future dates too. Add a date comparison if you only want overdue tasks. Use the same attribute name in your tasks and query.

Open the result’s ⋯ menu and choose **Edit in query builder** to adjust the list. [[Workbench/Data]] describes the controls, and [[Guide/When Results Update]] explains when saved and indexed changes appear.
