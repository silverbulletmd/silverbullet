```meta
type: plug
uri: builtin:core
repo: https://github.com/silverbulletmd/silverbullet
author: Silver Bullet Authors
$disableDirectives: true
```

This documentation is still a WIP.

## Templating
The core plug implements a few templating mechanisms.

### Page Templates
The {[Template: Instantiate Page]} command enables you to create a new page based on a page template. 

Page templates, by default, are looked for in the `template/page/` prefix. So creating e.g. a `template/page/Meeting Notes` page, will create a “Meeting Notes” template. You can override this prefix by setting the `pageTemplatePrefix` in `SETTINGS`.

Page template have one “magic” type of page meta data that is used during instantiation:

* `$name` is used as a default value for a new page based on this template

In addition, any standard template placeholders are available (see below)

For instance:

    ```meta
    $name: "📕 "
    ```

    # {{page}}
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
Snippets are similar to page templates, except you insert them into an existing page with the `/snippet` slash command. The default prefix is `snippet/` which is configurable via the `snippetPrefix` setting in `SETTINGS`.

Snippet templates do not support the `$name` page meta, because it doesn’t apply.

However, snippets do support the special `|^|` placeholder for placing the cursor caret after injecting the snippet. If you leave it out, the cursor will simply be placed at the end, but if you like to insert the cursor elsewhere, that position can be set with the `|^|` placeholder.

For instance to replicate the `/query` slash command as a snippet:

    <!-- #query |^| -->

    <!-- /query -->

Which would insert the cursor right after `#query`.

### Dynamic template injection
In addition to using the `/snippet` slash command to insert a template as a one-off, it’s also possible to reuse templates that update dynamically (similar to [[🔌 Query]]). For this,  you use the `#use` and `#use-verbose` directives.

In its most basic form:

    <!-- #use [[template/plug]] -->
    <!-- /use -->

Upon load (or when updating materialized queries) the body of this dynamic section will be replaced with the content of the referenced template.

The referenced template will be treated as a Handlebars template (just like when using a `render` clause with `#query`). 

Optionally, you can pass any JSON-formatted value as an argument, which will be exposed in the template as the top-level value.

For example, given the following template:

    Hello there {{name}} you are {{age}} years old!

You can reference and instantiate as follows:

    <!-- #use [[template/plug]] {"name": "Pete", "age": 50} -->
    <!-- /use -->

If a template contains any dynamic sections with directives, these will all be removed before injecting the content into the page. This makes things look cleaner. If you want to preserve them, use `#use-verbose` instead of `#use`.

### Daily Note
The {[Open Daily Note]} command navigates (or creates) a daily note prefixed with a 📅 emoji by default, but this is configurable via the `dailyNotePrefix` setting in `SETTINGS`. If you have a page template (see above) named `Daily Note` it will use this as a template, otherwise the page will just be empty. 

### Quick Note
The {[Quick Note]} command will navigate to an empty page named with the current date and time prefixed with a 📥 emoji, but this is configurable via the `quickNotePrefix` in `SETTINGS`. The use case is to take a quick note outside of you current context. 

### Template placeholders
Currently supported (hardcoded in the code):

* `{{today}}`: Today’s date in the usual YYYY-MM-DD format
* `{{tomorrow}}`: Tomorrow’s date in the usual YYY-MM-DD format
* `{{yesterday}}`: Yesterday’s date in the usual YYY-MM-DD format
* `{{lastWeek}}`: Current date - 7 days
* `{{page}}`: The name of the current page
