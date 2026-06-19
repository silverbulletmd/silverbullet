---
tags: adr
status: accepted
date: "2022-04-06"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-06-19"
related:
  - "[[ADR/002 Sync Engine]]"
  - "[[ADR/007 Core Application Logic on the Client]]"
---
# Context
SilverBullet aims to be **offline-first**: it should keep working with no network and feel instant. While we may reach a point in the state of the world some day where Internet connectivity is always available, we’re not there yet. You should be able to access your notes even when you’re in the middle of a dessert, top of a mountain, or 10km deep in the sea. For that, the client keeps a full local copy of your [[Space]] files and keeps working when the server is unreachable. (This offline-first stance later drove the v2 decision to run *all* application logic in the client — see [[ADR/007 Core Application Logic on the Client]].)

# Decision
The client is a **Progressive Web App built around a service worker**. The service worker:

* keeps a full local copy of the space's files in **IndexedDB**;
* hosts the [[Object Index|index]] and the [[Sync|sync engine]];
* **intercepts the HTTP API** and serves it locally, so the app behaves the same whether or not the server is reachable;
* caches and serves the client code itself.

See [[Architecture#Service Worker]].

# Consequences
## Positive
* **Works offline, feels instant.** Reads, queries and the index are local — no network on the critical path.
* **Resilient.** On a network error the client falls through to local data instead of failing.
* **Keeps the server “dumb”.** The service worker speaking the HTTP API locally is exactly what lets the server stay a thin file store ([[ADR/010 Rust Backend]]).

## Negative / trade-offs
* **Full local copy + per-client index.** Every browser/device syncs the space and builds its own IndexedDB index — storage plus a cold-start (re)index cost (see [[ADR/007 Core Application Logic on the Client]]). Occasionally a storage-schema change forces a full resync + reindex on all devices.
* **Service workers are fiddly.** Lifecycle/activation bugs, cross-tab IndexedDB deadlocks, and browser quirks are an ongoing maintenance cost.

# Alternatives considered
* **Online-only (no service worker).** Rejected: no offline support and a network round-trip on every operation — defeats the offline-first goal. (Still available deliberately via `SB_DISABLE_SERVICE_WORKER`.)
* **Bundle a native runtime for offline.** Rejected: heavier and platform-specific; a PWA delivers offline on every platform from one codebase.

# References
* [[Architecture#Service Worker]] and [[Sync]].
