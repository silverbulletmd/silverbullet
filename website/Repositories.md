> **note** Note
> This page contains sections that apply to the current _edge_ release, it is not part of an official release yet.

> **warning** Beta feature
> This is a **beta** feature. Feel free to use it, but it may change (significantly) in the future or potentially replaced.

Repositories are a collection of _pointers_ to [[Libraries]] to install. Their purpose is to discovery libraries to install.

By default, SilverBullet ships with one repository ([[^Repositories/Std]]) but more can be installed via the [[Library Manager]].

Repositories are kept under the `Repository/` prefix in your space by convention.

Repositories are implemented on top of a few SilverBullet mechanisms, specifically they are simply [[Meta Pages]] tagged with `#meta/repository` that contain [[Objects#data]] objects tagged with `#meta/library/remote` with a `name` and `uri` attribute. Libraries are kept up to date using the [[Share]] mechanism.