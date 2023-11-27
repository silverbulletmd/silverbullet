#plug

The [[🔌 Template]] plug implements a few templating mechanisms.

### Page Templates
> **Warning** Deprecated
> Use [[Slash Templates]] instead

The {[Template: Instantiate Page]} command enables you to create a new page based on a page template.

Page templates, by default, are looked for in the `template/page/` prefix. So creating e.g. a `template/page/Meeting Notes` page will create a “Meeting Notes” template. You can override this prefix by setting the `pageTemplatePrefix` in `SETTINGS`.

Page templates have one “magic” type of page metadata that is used during
instantiation:

* `$name` is used as the default value for a new page based on this template

In addition, any standard template placeholders are available (see below)

For instance:

    ---
    $name: "📕 "
    ---

    # {{@page.name}}
    As recorded on {{today}}.

    ## Introduction
    ## Notes
    ## Conclusions

Will prompt you to pick a page name (defaulting to “📕 “), and then create the following page (on 2022-08-08) when you pick “📕 Harry Potter” as a page name:

    # 📕 Harry Potter
    As recorded on 2022-08-08.

    ## Introduction
    ## Notes
    ## Conclusions

### Snippets
$snippets
> **Warning** Deprecated
> Use [[Slash Templates]] instead

Snippets are similar to page templates, except you insert them into an existing page with the `/snippet` slash command. The default prefix is `snippet/` which is configurable via the `snippetPrefix` setting in `SETTINGS`.

Snippet templates do not support the `$name` page meta, because it doesn’t apply.

However, snippets do support the special `|^|` placeholder for placing the cursor caret after injecting the snippet. If you leave it out, the cursor will simply be placed at the end, but if you like to insert the cursor elsewhere, that position can be set with the `|^|` placeholder.

For instance to replicate the `/query` slash command as a snippet:

    <!-- #query |^| -->

    <!-- /query -->

Which would insert the cursor right after `#query`.

### Daily Note

The {[Open Daily Note]} command navigates (or creates) a daily note prefixed with a 📅 emoji by default, but this is configurable via the `dailyNotePrefix` setting in `SETTINGS`. If you have a page template (see above) named `template/page/Daily Note` it will use this as a template, otherwise, the page will just be empty (this path is also configurable via the `dailyNoteTemplate` setting).

### Weekly Note

The {[Open Weekly Note]} command navigates (or creates) a weekly note prefixed
with a 🗓️ emoji by default, but this is configurable via the `weeklyNotePrefix` setting in `SETTINGS`. If you have a page template (see above) named `template/page/Weekly Note` it will use this as a template, otherwise, the page will just be empty.

### Quick Note

The {[Quick Note]} command will navigate to an empty page named with the current date and time prefixed with a 📥 emoji, but this is configurable via the `quickNotePrefix` in `SETTINGS`. The use case is to take a quick note outside of your current context.

## Built-in slash commands
* `/frontmatter`: Insert [[Frontmatter]]
* `/h1` - `/h4`: turn the current line into a header
* `/code`: insert a fenced code block
* `/hr`: insert a horizontal rule
* `/table`: insert a table
* `/page-template`: insert a page template
* `/today`: insert today’s date
* `/tomorrow`: insert tomorrow’s date
