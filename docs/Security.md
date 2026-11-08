---
tags: administration
references:
- server/src/router.rs
- server/src/handlers/fs.rs
- client/markdown_renderer/sanitize_html.ts
- server/src/multi/config.rs
---
SilverBullet [[Space|spaces]] are scriptable environments. This is where a lot of SilverBullet’s power and flexibility comes from. This page lays out the trust model that follows from that, so you can configure a deployment that matches who you’re sharing it with. For a more basic walk-through of concrete setups, see [[Security Profiles]].

Editors can collaborate on ordinary pages without receiving Builder access. The server protects `Library/` and root `CONFIG.md` from Editor writes, including deletes and rename destinations. Existing `write` grants still mean Builder access.

# Access levels
Each space resolves to one of four [[Dashboard#Access|access levels]] for a visitor, plus a separate admin flag:

* **No access (`none`):** Not visible; requests are refused.
* **Reader (`read`):** Read content and use its queries and installed widgets.
* **Editor (`edit`):** Also edit ordinary pages and attachments, but not protected configuration or library files.
* **Builder (`write`):** Full content and extension-authoring access, including capability endpoints when enabled.

Admins get Builder access on every space and the `/.dashboard` management UI. A frozen space remains read-only for everyone.

# What `write` really means
Builders can install code that runs as other visitors, including administrators. **Grant Builder only to people you trust to act as those visitors.** Editor is the role for collaborators who should edit content without installing code. Use separate origins when you need to isolate spaces with different trust levels; see [[Security Profiles]].

Only [[Space Lua]] definitions in `Library/` and root [[CONFIG]] load as trusted global code. Ordinary pages’ inline expressions and [[Space Lua/Page Lua|Page Lua]] run with restricted APIs, even when a Builder or administrator opens them. They can query and read space data, and call explicitly exposed installed functions, but cannot directly access JavaScript, the DOM, arbitrary syscalls or write APIs. See [[Space Lua/Capabilities]] for migration and library authoring.

An installed function’s capability annotation exposes a trusted entry point; it does not sandbox that function’s implementation. Builders must review its implementation, arguments, callbacks and rendered content before making it available to ordinary pages.

# Capability endpoints
These endpoints require Builder (`write`) access:

* **Shell** (`/.shell`) — runs commands on the server when enabled (off by default).
* **HTTP proxy** (`/.proxy`, exposed as [[API/net#net.proxyFetch(url, options?)|net.proxyFetch]]) — fetches external URLs through the server’s network.
* **Runtime API** (`/.runtime`) — evaluates Lua through a headless browser, subject to its separate member permission and server setting; see [[Runtime API]].

# Limits of isolation
Restricted expressions have execution budgets and limits on transferred data. They still run in the browser process: a large allocation or a native operation that does not yield can exhaust memory or block the UI. This is not process-level resource isolation, and does not guarantee availability against hostile content. Trusted installed code retains the viewer’s authority.
