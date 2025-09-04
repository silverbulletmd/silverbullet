An attempt at documenting the changes/new features introduced in each release.

## Edge
These are changes live on the edge builds:

* Rearchitected the sync engine
  * Sync engine now runs in service worker
  * Can be disabled by disabling the service worker using `?enableSW=0` (persists between reloads, enable via `?enableSW=1`)

## 2.0.0
* We’re now live!

For previous versions, see [the v1 CHANGELOG](https://v1.silverbullet.md/CHANGELOG)