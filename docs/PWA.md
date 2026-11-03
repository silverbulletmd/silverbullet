---
description: "SilverBullet Server’s installable web client with offline access."
tags: glossary
references:
- client/service_worker.ts
- client/boot.ts
---
SilverBullet Server’s browser client is a [Progressive Web App](https://web.dev/progressive-web-apps/) (PWA). It can be installed in a standalone window and can read and edit cached content offline. [[Desktop]] is the native application, with files stored in local folders.

# What the PWA gives you
* **Offline access**: After an online load and completed sync, cached pages are available without a network connection. Edits are stored locally and reconciled when you reconnect. Documents are fetched on demand unless you enable document caching in [[Sync#Configuration]].
* **App-like experience**: Install SilverBullet as a standalone app on your device — it gets its own window, icon, and feels like a native application.
* **Instant loading**: Since your content is synced to your browser’s local storage, cached pages can load without fetching their content from the Server.

# How to install
* **Chrome / Edge / Chromium-based**: Click the install icon in the address bar, or use the browser menu to “Install SilverBullet”
* **Safari (iOS / macOS)**: Use “Add to Home Screen” from the share menu
* **Android**: Use “Add to Home Screen” or “Install app” from the browser menu

Once installed, SilverBullet appears in your app launcher / dock / home screen like any other app.

# How offline works
SilverBullet’s [[Sync]] engine keeps configured space content in the browser’s IndexedDB. Pages are synchronized by default. Documents and ignored paths have different rules. When online, changes are continuously synced between the browser and the server. When offline, you work against the local copy. On reconnection, the sync engine reconciles any changes.

A service worker caches the application code itself, so even the SilverBullet UI loads without a network connection.

See also: [[Sync]], [[Collaboration]] (what happens to your offline edits when you reconnect), [[Architecture]]

# Limits
Offline startup requires a secure context (HTTPS or localhost), a working service worker and previously cached application code. Plain LAN HTTP runs online-only. See [[TLS#LAN HTTP (no TLS)]]. Installing the PWA does not change these requirements.

Server-backed [[Search]], shell execution, remote sharing and external network APIs require a connection. Local page navigation, editing and queries over the client Object Index can work with cached data. Let the initial sync finish and test the pages and attachments you need before relying on offline access. Browser storage is not a backup.
