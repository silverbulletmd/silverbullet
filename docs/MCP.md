---
tags: maturity/experimental
references:
- server-mcp/**
- bin/silverbullet/src/multi.rs
---
SilverBullet can act as an [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server, so AI assistants can read, write, query and pimp up your spaces.

MCP is available in [[Dashboard|multi-space mode]] and in [[Desktop]]. The endpoint is `/.mcp` on your server, for example `https://notes.example.com/.mcp`. A single-space server does not serve it. On a server it is off by default: an admin turns it on in the APIs tab of the [[Dashboard]].

# Tools
Every client sees the same tools on every space:

* `help`: the first call. Lists the spaces you can use, whether each has a runtime, and the skills available. Tools take a space by its name or its id, the id is needed only when two of your spaces share a name.
* `read`, `write` and `edit`: read pages (a part of one, several at once, or rendered with queries evaluated and lint problems listed), write whole pages, or make targeted edits. Writing a page with Space Lua or Space Style reloads it and reports any load errors.
* `search`: full-text (and, where enabled, semantic) [[Search]] over a space.
* `lua`: run [[Space Lua]] in the live space, with the result and console output. Needs the [[Runtime API]].
* `screenshot`: render a page or part of it. Needs the [[Runtime API]].

# Skills
Skills are pages tagged `meta/skill` in their frontmatter (the ones bundled with SilverBullet, in installed libraries, and your own), plus library pages tagged `meta/library` outside `Library/Std`. `help` lists them with their descriptions (for a library without one, its first sentence), and an agent loads one by reading the page, similar to how an AI agent handles skills natively.

# Access
The assistant acts as the account that approved the connection, and only for the spaces you ticked on the consent page (all spaces where you can write are ticked by default). Other spaces are reported as unavailable. A connection follows your account: if your access to a space drops below write, or an admin removes your account, the assistant loses it at once. `lua` and `screenshot` additionally follow the account’s per-space [[Runtime API]] permission, and are unavailable while the Runtime API is disabled.

# Setup
Clients sign in with standard OAuth: you add the server URL, your browser opens a SilverBullet page where you log in, choose the spaces and press Allow, and the client keeps the connection.

## Codex
```shell
codex mcp add silverbullet --url https://notes.example.com/.mcp
codex mcp login silverbullet
```

## Claude Code
```shell
claude mcp add --transport http silverbullet https://notes.example.com/.mcp
```

Then run `/mcp` inside Claude Code and choose to sign in.

## Claude.ai and ChatGPT
Add a custom connector (Claude.ai: Settings, Connectors; ChatGPT: Settings, Connectors, developer mode) with the URL `https://notes.example.com/.mcp` and sign in when asked.

## Other clients
Any client that speaks Streamable HTTP MCP and supports OAuth 2.1 should work. A client identifies itself with a client ID metadata document (an https URL as its client ID) or registers dynamically. Most clients are public and rely on PKCE alone; a client whose metadata document registers `private_key_jwt` (as ChatGPT does) must also sign a client assertion at the token endpoint with a key from its published JWKS (RS256, PS256 or ES256).

# Desktop
SilverBullet Desktop serves MCP too, for the spaces registered in the app, on a loopback listener at `http://127.0.0.1:3999/.mcp`. It is off by default. Turn it on or change the port under **Settings → Advanced → MCP**, which also shows the setup commands with your port filled in.

# Security
A connection carries the authority of the account that approved it, limited to the spaces chosen on the consent page. Page content read through MCP reaches the assistant (and its provider), and `lua` can do anything a user can script, so only connect assistants you trust with the spaces involved. Pages in shared spaces can be written by other people, and a page can contain text meant to steer the assistant, so be careful with spaces others can edit. Desktop's endpoint has no sign-in or consent page: while it is on, any program on your computer can use every registered space through it.

Connected apps are listed under **Connected apps** in your Profile (admins see everyone’s under APIs in the Dashboard), each with a Revoke button. Changing your password, choosing “sign out everywhere” or having your account disabled disconnects all your apps and removes them from the list.