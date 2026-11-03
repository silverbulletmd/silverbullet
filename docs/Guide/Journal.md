---
tags: guide
references:
- libraries/Library/Std/Journal/Journal.md
- libraries/Library/Std/Journal/Template.md
---
Use a daily journal to capture observations, tasks and decisions as they happen. Link entries to their topic pages so you can find them from either place. Creating or editing entries requires a writable space.

# Open today’s page
Run **Journal: Today**, or press **Ctrl-q j**. The command opens today’s page, normally `Journal/YYYY-MM-DD`. If it does not exist, SilverBullet creates it from the journal template, with a bullet list ready for writing. Running the command again returns to the same page.

Write entries as bullets, paragraphs or tasks. Journal pages are ordinary Markdown pages, so you can organize their content however you prefer.

# Connect entries to topics
Type `[[` to link a topic page from an entry. On the linked page, [[Linked Mention|Linked Mentions]] shows the journal reference with its surrounding context. Later entries linking to the same topic appear there too, without a separate list to maintain.

Keep lasting information on the topic page and use the journal for dated activity. [[Guide/Knowledge Base]] describes organizing topic pages.

# Browse earlier entries
* **Journal: Picker** lists journal pages.
* **Journal: Previous Day** (**Ctrl-q p**) opens an earlier entry.
* **Journal: Next Day** (**Ctrl-q n**) opens a later entry.

The previous and next commands navigate existing entries. They do not create pages for missing days.

# Customize the journal
Open **Workbench: Configuration** and select the **Journal** category. Save and apply your changes there.

* **Enable journal** turns the journal commands on or off.
* **Journal page prefix** controls the names of new entries. The default is `Journal/`. End the prefix with `/` to group entries in a folder.
* **Journal tag** identifies journal pages for navigation. The default is `journal`.
* **Journal template page** supplies the initial content of new entries.

To customize the template, copy [[^Library/Std/Journal/Template]] to a writable page, edit the copy, and select it in **Journal template page**. The bundled template is read-only.

See [[Workbench/Configuration]] for applying settings and [[Page Template]] for template syntax.
