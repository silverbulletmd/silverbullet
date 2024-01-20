Page templates enable you to define templates for creating new pages. They can be invoked in a few ways:

* Explicitly using the {[Page: From Template]} command
* Explicitly using a custom command configured in the template
* Implicitly when configured to be used automatically for a specific _page prefix_.

A page template is a [[Templates|template]] using the `hooks.newPage` attribute (in [[Frontmatter]]).

The following configuration options are supported:

* `suggestedName`: the proposed name for the new page, can use template placeholders such as `{{today}}`.
* `confirmName`: Confirm the suggested page name before creating it (defaults to `true`).
* `openIfExists`: If a page with the `suggestedName` already exists, open it instead of overwriting it. This is useful to implement page templates like [[Library/Journal/New Page/Daily Note]].
* `forPrefix`: automatically apply (or offer, when multiple page templates match) this page template for page names that start with this prefix.
* `command`: expose the snippet as a [[Commands|command]].
* `key`: Bind the snippet to a keyboard shortcut (note: this requires to _also_ specify the `command` configuration).
* `mac`: Bind the snippet to a Mac-specific keyboard shortcut.

An example:

    ---
    tags: template
    hooks.newPage:
      suggestedName: "📕 "
      forPrefix: "📕 "
    ---
    # {{@page.name}}
    As recorded on {{today}}.

    ## Introduction
    ## Notes
    ## Conclusions

When using the {[Page: From Template]} command and selecting this template, this will prompt you to pick a page name (defaulting to “📕 “), and then create the following page (on 2023-08-08) when you pick “📕 Harry Potter” as a page name:

    # 📕 Harry Potter
    As recorded on 2022-08-08.

    ## Introduction
    ## Notes
    ## Conclusions

In addition, this page template will be used automatically when you create _any_ new page starting with “📕 “ by navigating to a new page matching this prefix, such as “📕 Foundation”.

As with any [[Templates|template]], the `frontmatter` can be used to define [[Frontmatter]] for the new page.