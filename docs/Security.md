---
tags: getting-started
references:
- server/src/router.rs
- server/src/handlers/fs.rs
- client/markdown_renderer/sanitize_html.ts
- server/src/multi/config.rs
---
SilverBullet [[Concepts/Space|spaces]] are scriptable environments, not passive documents. This is where a lot of SilverBullet’s power and flexibility comes from. This page lays out the trust model that follows from that, so you can configure a deployment that matches who you're sharing it with. For a friendlier walk-through of concrete setups, see [[Deployment/Security Profiles]].

**TL;DR:** you need to trust people with `write` access. Anyone who can write to a space can author content — [[Space Lua]], and dynamic content generally — that runs in the browser of anyone who later opens that space.

# Access levels
Each space resolves to one of three [[Features/Space Manager#Access|access levels]] for a given visitor, plus a separate admin flag:

| Level | Meaning |
| --- | --- |
| `none` | Not visible. Requests are refused. |
| `read` | May view content, will run all scripts and queries locally. Cannot modify anything or reach any capability endpoint. |
| `write` | Full access to the space's content **and** capabilities. |

Admins get `write` on every space, plus the `/.spaces` management UI.

# What `write` really means
`write` is not just “can edit files” in the narrow sense — a `write` member can cfreate content that runs, unattended, as whoever else opens that space. That includes admins.

The practical rule: **grant `write` only to people you’d trust to act as any member of every space they can reach.** If someone doesn’t clear that bar, don’t add them as a `write` member of a space other trusted people also use, give them their own space, on its own (sub)domain instead (see [[Deployment/Security Profiles#Software team / untrusted-at-scale]]). SilverBullet does not offer an in-between “can edit, but can't script” role within a single space.

# Capability endpoints
A few endpoints can reach beyond the space’s own content, and all require `write`:

* **Shell** (`/.shell`) — runs any command on the server. (Off by default)
* **HTTP proxy** (`/.proxy`, exposed to Lua as [[API/net#net.proxyFetch(url, options?)|net.proxyFetch]]) — fetches an external URL through the server, on the server’s network.
* **Runtime API** (`/.runtime`) — evaluates Lua and scripts via a headless browser instance, see [[Features/Runtime API]].
