In SilverBullet, you can create links to pages or documents inside your space as well as to external resources, using different link formats.

# External links
- _Markdown links_, using the `[title](URL)` syntax, for instance: [SilverBullet community](https://community.silverbullet.md). If the URL contains a space or closing parenthesis, you can enclose the URL in angled brackets.
* _"[AutoLinks](https://spec.commonmark.org/current/#autolinks)"_, like <https://community.silverbullet.md>
* _“Naked” URL links_ (AKA _"Bare URLs"_), like https://community.silverbullet.md

# Internal links
- _Relative internal links_, using the `[title](<relative specifier><link>)` format. The _relative specifier_ can be used to move up the file tree (or down, if you picture a file tree like this 🌳) relative to the page the link is on, similar to POSIX file systems `/../`. The _link_ has to conform to the [[#Link syntax (String refs)|link syntax]]
* _Absolute internal links_ (also called wikilinks) using the `[[<link>]]` syntax. Again the _link_ has to conform to the link syntax. A alias can be added like this `[[<link>|This link points to <link>]]`

# Link syntax (String refs)
The link or “string refs” has to follow some specific formatting:
* A string ref starting with `^` links to a meta page, see [[#Caret page links|caret page links]]
* The "core" (After a possible `^` and before a `@` or `#`) of a string ref is a [[Names|name]] or [[Paths|path]].
  * The core of a  string ref can also be empty, an empty path points to the current page for links, and to the index page for `editor.navigate`
* A string ref can end three ways:
  * `#` followed by a string (which can also contain `#`). This will point to the header equal to that string. (Notably you can't link to every possible header, because e.g. `]]` will restrict you inside a wikilink for example.), e.g. [[SilverBullet#Introduction]]
  - `@` followed by an upper or lowercase `L` followed by a number, optionally followed by an upper or lowercase `C` followed by a number (e.g. `@l12c13`). This will point to the corresponding line and column inside a page (both 1-based), e.g. [[CHANGELOG@L12c42]]
  - `@` followed by a number _n_. This will point to the _nth_ character in the page (0-based), e.g. [[CHANGELOG@123]]

# Caret page links
[[Meta Page]] are excluded from link auto complete in many contexts. However, you may still want to reference a meta page outside of a “meta context.” To make it easier to reference, you can use the caret syntax: `[[^Library/Std]]`. Semantically this has the same meaning as `[[LIbrary/Std]]`. The only difference is that auto complete will _only_ complete meta pages.
