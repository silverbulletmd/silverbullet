---
description: "Multi-space and legacy single-space modes in SilverBullet Server."
---
A fresh data folder starts Server’s multi-space setup. An existing folder of pages can still run as a legacy single-space installation. The mode changes administration and access, rather than the Markdown format.

# Single-space mode
Single-space mode serves one folder with one optional login configured through `SB_USER`.

* It has no multiple-account management or per-member space roles.
* [[Revisions]] has limited configuration, including remote Git setup.
* [[Single Sign-On]] is unavailable.
* Mentions still support ad-hoc and API-defined identities. Account-based completion is unavailable.

Use [[Install/Configuration]] for legacy environment variables. Without authentication, anyone who can reach the server can access the space. Migrate to multi-space mode for account-managed sharing.

# Multi-space mode
The default mode supports multiple spaces, local or SSO accounts, public access settings, per-member read/write roles and managed [[Revisions]] with optional Git sync. Manage these through the [[Dashboard]]. A single space with one account is also a valid configuration.

# Migrating from single-space to multi-space
1. Back up your old space, including its revision repository if needed. Keep the original installation available until you have verified the copy.
2. Start a separate Server instance with a fresh data folder.
3. Complete the web setup and create a space. Note its physical folder, such as `spaces/notes` inside the data folder.
4. Copy your old space files into that space folder. Do not replace the new server’s account and administration files with space content.
5. Open the new space, verify pages, attachments and libraries, and configure access and revisions in the Dashboard.
6. Reconnect clients to the new URL only after verification.
