---
tags: administration
references:
- server/src/multi/config.rs
- server/src/router.rs
- server/src/handlers/fs.rs
- client/markdown_renderer/sanitize_html.ts
---
SilverBullet [[Dashboard|spaces]] are **scriptable** — a member with `write` access can author [[Space Lua]] and other dynamic content that later runs in the browser of anyone who opens that space. This is a feature that makes SilverBullet the powerful that it is, but it also brings inherent security risks.

This means the right deployment shape depends on how much you trust the people you share a space with. This page walks through two common profiles. For the full model behind them, see [[Security]].

The choice in one line: **convenience and flexibility** (one hostname, [[Dashboard#Bindings|path bindings]], shell on) vs. **isolation** (a space per origin, shell off) — and which is right depends on trust.

# Personal/fully-trusted
You, your family, or a small circle who all trust each other completely and know what they’re doing (i.e. don’t copy random scripts into the space). These deployments can use several [[Dashboard#Bindings|path bindings]] on one hostname, shell on or off as you like. This is fine.

**If everyone you share a space with is fully trusted, this is all you need.**

# Software team
A team, community, or any setup where a `write` member _might_ plant malicious content — deliberately or by having their own account compromised — for a more-privileged member (an admin, or a member of another space) to stumble into.

The recommended hardened profile:

* **Shell off** for spaces with untrusted writers. This removes the main capability an attacker could otherwise reach.
* **One hostname per space**, via a [[Dashboard#Bindings|custom-host binding]] rather than multiple path prefixes on one hostname. Use the primary URL for the `/.dashboard` admin surface through **Admin → Server**. Then configure a separate sub-domain per space. With this configured, the server rejects Dashboard APIs on space hosts and blocks browser requests to Dashboard APIs from other origins, including sibling subdomains.

**Why a hostname per space?** SilverBullet’s session cookie and browser origin are scoped to the hostname you’re on. A `write` member can make their space’s content run code as whoever opens it — but if each untrusted-writer space lives on its own hostname, that code runs in an origin that doesn’t hold another space's session.

This profile benefits from wildcard DNS (or at least multiple sub-domains mapped) and a wildcard TLS certificate (or multiple custom-configured certificates).
