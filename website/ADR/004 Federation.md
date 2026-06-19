---
tags: adr
status: deprecated
date: "2023-07-04"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
---
# Context
Users wanted to reference and read pages from *other* spaces, shared libraries, public/published spaces without copying the content into their own.

# Decision
Add **federation**: a space can link to a remote space via a federated URL prefix, and SilverBullet would sync that external content read-only into the local client, so it could be browsed and queried alongside local pages.

# Consequences
## Positive
* Let a space pull in shared content (libraries, onboarding material) directly by reference, kept up to date.

## Negative / trade-offs
* Significant complexity in the sync and index paths for a relatively niche use case as well as potential security issues: listing timeouts, reference rewriting, [[Space Lua]] code injection risks.

# Status update
**Deprecated and removed (2025).** Federation was taken out: the maintenance cost outweighed its limited use, and shared content is better served by other mechanisms ([[Library]], copying, or publishing). It has no direct replacement.

# References
* Federation removed: [commit dbfc5995](https://github.com/silverbulletmd/silverbullet/commit/dbfc5995) — "More thorough removal of federation".
