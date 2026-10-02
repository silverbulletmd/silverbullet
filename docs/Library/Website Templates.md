---
tags: meta
references:
- libraries/Library/Std/Infrastructure/Share.md
---
A few templates used on the docs.silverbullet.md website.

```space-lua
templates.featureItem = template.new[==[
    * [[${name}]]: ${description}
]==]

templates.docsSection = template.new[==[
    * [[${docsNav.entryByName(name).ref}|${name}]]: ${description}
]==]

templates.docsPage = template.new[==[
    * [[${ref}|${name:match "[^/]+$"}]]: ${docsNav.summary(ref) or ""}
]==]
```