---
tags: maturity/beta
references:
- client/workbench/libraries/libraries_backend.ts
- libraries/Library/Std/Infrastructure/Share.md
---
Repositories are a collection of _pointers_ to [[Library|Libraries]] to install. Their purpose is to offer a curated list of libraries to install.

By default, SilverBullet ships with two repositories: [[^Library/Repository/Std]] with a curated selection of community libraries, and [[^Library/Repository/SilverBulletMD]] with optional libraries maintained by the SilverBullet project. More can be installed via the [[Workbench/Libraries|Library Manager]].

The built-in repositories update like any other: the first update stores a copy in your space, which from then on takes the place of the shipped version. Deleting that copy brings the shipped version back, so built-in repositories can’t be removed.

Repositories are implemented on top of a few SilverBullet mechanisms, specifically they are simply [[Tool Page|Tool Pages]] under `Library/Repository/` tagged with `#meta/repository` that contain [[Tag/data|data objects]] tagged with `#meta/library/remote` with a `name` and `uri` attribute. Libraries are kept up to date using the [[Share]] mechanism.

Repositories used to live under `Repositories/`. Pages there are no longer treated as repositories, so delete them by hand.
