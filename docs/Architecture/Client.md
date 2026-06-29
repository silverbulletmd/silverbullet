---
tags: component
connectsTo:
- "[[Architecture/Service Worker]]"
references:
- client/client.ts
- client/editor_ui.tsx
- client/client_system.ts
---
One instance per browser tab. The client renders the UI, interacts with the user, and runs **most of the logic** — 90%+ of SilverBullet lives here. It reaches the [[Architecture/Service Worker]] (and, when online, the [[Architecture/Server]] directly) through the [[HTTP API]].
