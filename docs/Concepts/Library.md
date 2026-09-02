---
description: A collection of reusable Space Lua scripts, templates, and pages that can be imported into your space.
tags: maturity/beta glossary
references:
- plugs/configuration-manager/libraries.ts
- libraries/Library/Std/Infrastructure/Share.md
---
SilverBullet is designed to be [[Features/Extensions|extensible]]. In fact, a lot of functionality in SilverBullet is implemented through [[Space Lua]] embedded in [[Concepts/Meta Page|Meta Pages]], other functionality is implemented using [[Plugs]]. 

A big part of the fun of SilverBullet is building your own extensions, big or small. Libraries are the way to [[Features/Share]] those extensions. Both for you to [[Concepts/Library/Development|publish your own]] libraries, and to pull in other people’s creations.

# Terms
Let’s define terms:

The [[Library]] is the **unit of distribution**, typically implemented as [[Concepts/Meta Page]]. Most libraries will be implemented in a single page (e.g. with a big [[Space Lua]] block), but more elaborate libraries may span multiple pages, some may wrap [[Plugs]].

A [[Concepts/Repository]] is a **discovery and curation mechanism** for libraries. They are collections of _pointers_ of _where_ to find libraries to install. SilverBullet ships with the [[^Repositories/Std]] repository, but you can install additional ones.

[[Features/Share]] is the general-purpose mechanism built into SilverBullet to both _push_, _pull_ and _sync_ content in your space with the outside world. In the context of Libraries this mechanism is used (partially under the hood, but you’ll recognize traces of it) both for you to _publish_ your libraries, as well as to _install_ and _update_ other people’s creations.

To make discovery and installation of libraries easier, SilverBullet includes a [[Features/Configuration Manager#Libraries|Library Manager]].

By convention, libraries are kept under the `Library/` prefix (folder) in your space.

# What’s in a library
Here are some things that a library may provide:
* Various [[Concepts/Slash Command|Slash Commands]], such as `/today`, `/task`, `/table`.
* Useful [[Concepts/Page Template|Page Templates]]
* Useful [[^Library/Std/Widgets/Widgets|Widgets]]
* Useful pages that help you perform maintenance on your space, like detecting broken links, such as [[^Library/Std/Pages/Maintenance]].
* Additional functionality with compiled [[Plugs]]

# Can I change libraries locally?
Libraries you manually installed can be freely changed. Do note that when you attempt to update them, your local changes may be overwritten.

The [[^Library/Std]] library comes “baked in” with SilverBullet and is read only. You cannot change it. However, for most things there are ways to override or disable standard behavior, check [[Space Lua#Load order]] for some hints.

# How do I develop my own library?
See [[Concepts/Library/Development]]
