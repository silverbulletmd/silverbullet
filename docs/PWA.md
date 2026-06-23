---
description: "SilverBullet's installable web-app mode for offline access and native-like experience."
tags: glossary
---

SilverBullet is built as a [Progressive Web App](https://web.dev/progressive-web-apps/) (PWA) — a web application that works fully offline.

# What the PWA gives you
* **Offline access**: After your first load and sync, all functionality is available without a network connection. Edits are stored locally and synced when you're back online.
* **App-like experience**: Install SilverBullet as a standalone app on your device — it gets its own window, icon, and feels like a native application.
* **Instant loading**: Since your content is synced to your browser's local storage, pages load instantly without network requests.

# How to install
* **Chrome / Edge / Chromium-based**: Click the install icon in the address bar, or use the browser menu to "Install SilverBullet"
* **Safari (iOS / macOS)**: Use "Add to Home Screen" from the share menu
* **Android**: Use "Add to Home Screen" or "Install app" from the browser menu

Once installed, SilverBullet appears in your app launcher / dock / home screen like any other app.

# How offline works
SilverBullet's [[Sync]] engine keeps a full copy of your space in the browser's IndexedDB. When online, changes are continuously synced between the browser and the server. When offline, you work against the local copy. On reconnection, the sync engine reconciles any changes.

A service worker caches the application code itself, so even the SilverBullet UI loads without a network connection.

See also: [[Sync]], [[Architecture]]
