---
description: How SilverBullet merges concurrent edits from other users, devices, agents and scripts, and what happens when they can't be merged automatically.
tags: glossary maturity/experimental
references:
- server-common/src/space/disk.rs
- server-common/src/space/conditional.rs
- server-common/src/reconcile.rs
- client/external_merge.ts
- client/codemirror/conflict_markers.ts
- client/codemirror/external_presence.ts
- client/sync_recovery.ts
- client/spaces/base_store.ts
- plugs/index/conflict.ts
---
A [[Concepts/Space]] can be shared: several people with [[Features/Space Manager|accounts]] on the same server, editing the same pages, alongside whatever scripts and agents write to those same files. SilverBullet supports this, but it does so in a very specific way.

One core premise of SilverBullet has always been that your [[Concepts/Space]] is just files on disk, and those files are the source of truth. This commitment extends to _who and how_ those files may be edited. SilverBullet deliberately does not want to be the “owner” of your files: third-party tools (or other people) should also be able to freely edit files.

For instance, you may have other markdown capable editors pointed at the same files (for whatever reason), scripts that append to files while you are editing them, coding agents that make edits, team mates connected to the same space.

SilverBullet will do its best to make this “diversity” of edits work.

However, because of the deliberate choice to embrace all these sources of edits, more “classic” real-time, collaborative editing (like e.g. Google Docs) e.g. via CRDT is tricky. Instead, a combination of active file watching and three-way merging gets us quite far.

This page describes just the editor’s real-time-ish behavior. Other features relevant for the collaboration use case are:

* [[Concepts/Recipient]]
* [[Markdown/Comment]]

# Auto-merging concurrent edits
When two edits land on the same file around the same time, the server reconciles them with a three-way merge (each side’s edit against the last version they agreed on) rather than just letting the last write win. 

Merging is line- and word-aware: if you and someone else edit *different words* in the same line or paragraph, both edits should land cleanly with no conflict. Edits that touch the same words collide — and so, occasionally, can edits that don't, when a slow or flaky connection leaves one side merging against an older version of the page than it has already received.

Propagation is near-realtime: a change made elsewhere typically shows up wherever else the file is open within a couple of seconds.

# Conflicts
Sometimes both sides really did change the same words, and there is no sane way to merge them automatically. When that happens, the file is written with Git-style conflict markers:

```
<<<<<<< SB sha256:1a2b3c4d
your version of the line
=======
their version of the line
>>>>>>> SB sha256:5e6f7a8b
```

You never have to read that by hand. The editor [[Features/Live Preview]]s each conflicted section as an _edit conflict_ widget showing both sides, as well as the original.

**Bonus:** this widget also recognizes **git-produced conflict markers** (`<<<<<<< HEAD` and friends), so if you keep your space in git and a merge leaves conflicts in a page, you can resolve them the same way.

## Binary conflicts
Images, PDFs and other binaries (and text files over the 1 MB merge limit) can’t be merged, so a genuine conflict instead produces a sibling copy named `name.conflicted-<hash>.ext` next to the original, where `<hash>` is a short hash of the losing version’s bytes.

# Live external edits and attribution
Changes written to a page you have open are applied to your open editor within moments, as small, cursor-preserving edits rather than a full page reload. They land in the undo history like any other edit, so `Cmd/Ctrl-z` reverts an external change too. The inserted text is briefly highlighted, fading out after a few seconds. When the server can verify who made the change via [[Features/Authentication]], the highlight carries a small label with that account’s display name; an anonymous write (a raw disk edit, a script) just gets the highlight, no label. This attribution is best-effort.

# Offline and flaky networks
SilverBullet remains [[Principles/Local First|local-first]]: edits you make offline (or while [[Features/Sync]] is struggling with a flaky connection) accumulate locally and reconcile with the server once you’re back online, following the same merge and conflict rules as above. A deletion never silently wins over a concurrent edit — if you edited a page that someone else deleted (or vice versa) while you were offline, the edit survives and the deletion is suppressed, surfaced to you as a notification rather than quietly discarding your work.

# What to expect
Merging is built to support users working on *different parts* of a page at the same time. Within that, it is close to invisible. Outside of it, mentally prepare for occasional issues.

Notably, realize:

* **This is not Google Docs.** There are no live cursors, and nothing warns you that someone else is in the page until their edit lands. Two people typing into the same paragraph at once is the case this design handles worst.
* **Give each other room.** Edits a line or more apart normally land cleanly and immediately. Edits inside the same line or paragraph usually still merge, but only after a short round trip through the server.
* **Sync works in _seconds_, not instantly.** Your work is saved about a second after you stop typing and then propagates to the server. Rapid back-and-forth in the same spot will outrun the merge.

# For API and script users
If you're writing directly to `/.fs` over the [[HTTP API]] rather than through the editor, see [[HTTP API#Conditional writes]] for how to use `ETag`/`If-Match` to avoid blindly overwriting someone else’s concurrent write.
