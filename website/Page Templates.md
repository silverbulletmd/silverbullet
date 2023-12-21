The {[Page: From Template]} command enables you to create a new page based on a page template. A page template is a [[Templates|template]] with the `type` attribute (in [[Frontmatter]]) set to `page`.

An example:

    ---
    tags: template
    type: page
    pageName: "📕 "
    ---
    # {{@page.name}}
    As recorded on {{today}}.

    ## Introduction
    ## Notes
    ## Conclusions

Will prompt you to pick a page name (defaulting to “📕 “), and then create the following page (on 2023-08-08) when you pick “📕 Harry Potter” as a page name:

    # 📕 Harry Potter
    As recorded on 2022-08-08.

    ## Introduction
    ## Notes
    ## Conclusions

As with any [[Templates|template]], the `frontmatter` can be used to define [[Frontmatter]] for the new page.