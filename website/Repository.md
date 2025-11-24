#maturity/beta

Repositories are a collection of _pointers_ to [[Library|Libraries]] to install. Their purpose is to offer a curated list of libraries to install.

By default, SilverBullet ships with one repository ([[^Repositories/Std]]), more can be installed via the [[Library Manager]].

Repositories are implemented on top of a few SilverBullet mechanisms, specifically they are simply [[Meta Page|Meta Pages]] tagged with `#meta/repository` that contain [[Object#data]] objects tagged with `#meta/library/remote` with a `name` and `uri` attribute. Libraries are kept up to date using the [[Share]] mechanism.

