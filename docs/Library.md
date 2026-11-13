---
description: "Reusable Space Lua scripts, templates and pages you can install in your space."
tags: maturity/beta glossary
references:
- client/workbench/libraries/libraries_backend.ts
- client/workbench/libraries/library_requires.ts
- libraries/Library/Std/Infrastructure/Share.md
---
SilverBullet is designed to be [[Extensions|extensible]]. In fact, a lot of functionality in SilverBullet is implemented through [[Space Lua]] embedded in [[Tool Page|Tool Pages]], other functionality is implemented using [[Plugs]].

A big part of the fun of SilverBullet is building your own extensions, big or small. Libraries are the way to [[Share]] those extensions. Both for you to [[Library/Development|publish your own]] libraries, and to pull in other people’s creations.

# Terms
Let’s define terms:

The [[Library]] is the **unit of distribution**, typically implemented as [[Tool Page|Tool Pages]]. Most libraries will be implemented in a single page (e.g. with a big [[Space Lua]] block), but more elaborate libraries may span multiple pages, some may wrap [[Plugs]].

A [[Repository]] is a **discovery and curation mechanism** for libraries. They are collections of _pointers_ of _where_ to find libraries to install. SilverBullet ships with the [[^Library/Repository/Std]] and [[^Library/Repository/SilverBulletMD]] repositories, but you can install additional ones.

[[Share]] is the general-purpose mechanism built into SilverBullet to both _push_, _pull_ and _sync_ content in your space with the outside world. In the context of Libraries this mechanism is used (partially under the hood, but you’ll recognize traces of it) both for you to _publish_ your libraries, as well as to _install_ and _update_ other people’s creations.

To make discovery and installation of libraries easier, SilverBullet includes a [[Workbench/Libraries|Library Manager]].

Libraries live under the `Library/` prefix (folder) in your space. This is a rule, not a convention: [[Space Lua]] and [[Space Style]] blocks only run from pages under `Library/`, so installing a library always puts it there.

# What’s in a library
Here are some things that a library may provide:
* Various [[Slash Command|Slash Commands]], such as `/today`, `/task`, `/table`.
* Useful [[Page Template|Page Templates]]
* Useful [[^Library/Std/Widgets/Widgets|Widgets]]
* Useful pages that help you look after your space. For broken links and other diagnostics, see the [[Workbench/Maintenance]] tab.
* [[Theming|Themes]] and [[Fonts|fonts]]
* Additional functionality with compiled [[Plugs]]

# Libraries that require other libraries
A library can **require** other libraries, so it builds on them instead of bundling copies: a theme can require the font library it uses, for instance. It lists them under `requires` in its frontmatter:

```yaml
name: Library/myuser/Themes/Paper
tags: meta/library
requires:
- ../Fonts/Lora.md
- github:otheruser/silverbullet-libraries@main/Library/otheruser/Inter.md
```

Each entry is the URI of a library, in one of two forms:
* A **full URI**, as you would give to **Install…** (`github:…`, `https://…`).
* A **relative path**, resolved against the requiring library’s own URI: same repository, same branch or tag. `../Fonts/Lora.md` next to `github:myuser/silverbullet-libraries@main/Library/myuser/Themes/Paper.md` is `github:myuser/silverbullet-libraries@main/Library/myuser/Fonts/Lora.md`. A path can’t climb out of the repository, and can’t start with `/`: start it with `./`, `../` or a file name.

What this does:
* **Installing** a library first installs every library it requires that isn’t installed yet (installed from the same URI, or already in your space under the page name it installs to), and what those require in turn. A library that requires itself, or a circle of libraries requiring each other, installs each library once. When a required library can’t be installed, or the library itself or one of its files fails, nothing is installed: the error names the library that failed, and whatever this install had already written is removed again. Libraries that were installed before stay.
* **Updating** a library installs the requirements it gained since. Requirements that are already installed aren’t updated with it: update them on their own. When a new requirement can’t be installed, the library stays updated and the error says so.
* **Removing** a library another installed library requires is refused, with a message such as “Paper requires Lora. Remove Paper first.” Removing the requiring library leaves what it required installed. Libraries that require each other in a circle don’t hold each other back.

The [[Workbench/Libraries|Library Manager]] shows each library’s requirements, and whether they are installed, and which installed libraries require it. See [[Library/Development#Require other libraries]] for publishing a library that requires others.

# Can I change libraries locally?
Libraries you manually installed can be freely changed. Do note that when you attempt to update them, your local changes may be overwritten.

The [[^Library/Std]] library comes “baked in” with SilverBullet and is read only. You cannot change it. However, for most things there are ways to override or disable standard behavior, check [[Space Lua#Definition loading]] for some hints.

# How do I develop my own library?
See [[Library/Development]]
