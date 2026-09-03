---
references:
- server/src/multi/config.rs
- server/src/router.rs
- server/src/handlers/fs.rs
- client/markdown_renderer/sanitize_html.ts
---
SilverBullet [[Features/Space Manager|spaces]] are **scriptable** — a member with `write` access can author [[Space Lua]] and other dynamic content that later runs in the browser of anyone who opens that space. This means the right deployment shape depends on how much you trust the people you share a space with. This page walks through the two common profiles. For the full model behind them, see [[Security]].

The choice in one line: **convenience and flexibility** (one domain, [[Features/Space Manager#Bindings|path bindings]], shell on) vs. **isolation** (a space per origin, shell off) — and which is right depends on trust.

# Personal / fully-trusted
You, your family, or a small circle who all trust each other completely and know what they’re doing (i.e. don’t copy random scripts into the space). For this setup, one domain, [[Features/Space Manager#Bindings|path/prefix bindings]] for your spaces, shell on or off as you like. This is fine.

**If everyone you share a space with is fully trusted, this is all you need.** Nothing below changes anything for you — a shared trust circle has no "untrusted writer" for isolation to protect against.

# Software team / untrusted-at-scale
A team, community, or any setup where a `write` member might plant malicious content — deliberately or by having their own account compromised — for a more-privileged member (an admin, or a member of another space) to stumble into.

The recommended hardened profile:

* **Shell off** for spaces with untrusted writers. This removes the main capability an attacker could otherwise reach — see [[Install/Configuration#Security|shell configuration]].
* **One subdomain per untrusted-writer space**, via a [[Features/Space Manager#Bindings|host binding]] rather than a path prefix. Also give the `/.spaces` admin surface its own dedicated hostname (one that no space is bound to), and always reach it there.

**Why a subdomain per space?** SilverBullet's session cookie is scoped to the exact hostname you’re on. A `write` member can make their space’s content run code as whoever opens it — but if each untrusted-writer space lives on its own hostname, that code runs in an origin that doesn’t hold anyone else’s session.

This profile needs wildcard DNS (or at least multiple sub-domains mapped) and a wildcard TLS certificate (or multiple custom-configured certificates) you manage yourself (see [[TLS]]).
