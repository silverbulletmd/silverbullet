---
tags: plug
---
The [[Plugs/Template]] plug implements a few templating mechanisms.

# Daily Note
The {[Open Daily Note]} command navigates (or creates) a daily note prefixed with a 📅 emoji by default, but this is configurable via the `dailyNotePrefix` setting in `SETTINGS`. If you have a page template (see above) named `template/page/Daily Note` it will use this as a template, otherwise, the page will just be empty (this path is also configurable via the `dailyNoteTemplate` setting).

# Weekly Note
The {[Open Weekly Note]} command navigates (or creates) a weekly note prefixed with a 🗓️ emoji by default, but this is configurable via the `weeklyNotePrefix` setting in `SETTINGS`. If you have a page template (see above) named `template/page/Weekly Note` it will use this as a template, otherwise, the page will just be empty.

# Quick Note
The {[Quick Note]} command will navigate to an empty page named with the current date and time prefixed with a 📥 emoji, but this is configurable via the `quickNotePrefix` in `SETTINGS`. The use case is to take a quick note outside of your current context.

# Built-in slash commands
* `/frontmatter`: Insert [[Frontmatter]]
* `/h1` - `/h4`: turn the current line into a header
* `/code`: insert a fenced code block
* `/hr`: insert a horizontal rule
* `/table`: insert a table
* `/page-template`: insert a page template
* `/today`: insert today’s date
* `/tomorrow`: insert tomorrow’s date
