---
tags: guide
---
Give a team one place for plans, decisions, instructions and requests. This guide uses Moonshot, a fictional photo-management application. Sam maintains releases; Jo works on design and documentation.

The workflow here uses a shared Server space. If your team reviews documentation through Git branches and pull requests, use [[Guide/Docs as Code]] instead. Automatic Git sync is a backup workflow, not a replacement for pull-request review.

# Give the team access
An administrator [[Install|sets up SilverBullet Server]], creates accounts and assigns access in the [[Dashboard]]. Give contributors write access and readers read access. Each person can open the space in a browser; Desktop users can optionally join it through [[Desktop Sync]].

Use account usernames for mentions in your real space. An [[Account]] grants access; an [[Identity]] is the name used in page content. Writing `@jo` does not create Jo’s account or grant access.

# Make a shared home
In a writable practice space, open the [[Page Picker]] with Cmd-k / Ctrl-k, enter `Moonshot Home` and press Shift-Enter. Add:

```markdown
Moonshot is our photo-management application.

* [[Moonshot Release]] — current release work
* [[Moonshot Import Instructions]] — instructions for importing photos
* [[Moonshot Decisions]] — decisions and their reasons
```

Follow each link and write a short page. Start with ordinary headings, links and tasks; a dashboard is optional. Set the space’s index page to `Moonshot Home` in **Space settings → General** when you want everyone to land there.

# Keep work beside its context
On `Moonshot Release`, record the release goal and an action item:

```markdown
# Before release
* [ ] @jo Review [[Moonshot Import Instructions]]. -- @sam
```

Jo can find the request through `Navigate: Mentions`, open the page and reply beside it. [[Guide/Mentions and Replies]] explains signatures, replies and resolving requests. In your real space, substitute the people who should receive the request.

Record a decision’s reason and consequences on its page, then link to it from the relevant project. When you need consistent decision status or ownership, add tags and attributes through the [[Frontmatter|frontmatter editor]]. Use [[Guide/Explore Your Data|Workbench]] to inspect them and [[Guide/Build Your First Query|build an overview]] without maintaining a second task list.

# Edit and review changes
Team members can edit the same space. Incoming edits generally appear within a few seconds; SilverBullet merges file changes without sharing cursor positions. If edits conflict, inspect both versions in the conflict widget before resolving them. [[Collaboration]] documents the detailed behavior.

Use [[Revisions]] to inspect earlier versions and account attribution. A typed signature such as `-- @sam` is self-declared prose, not proof of who edited a file. [[Guide/Storage and Recovery]] covers restoration and backups.

# Share beyond the team
Keep private team material in a private space. [[Publishing]] grants public reading access to a whole space; [[Guide/Publish a Collection]] copies selected pages to another destination. Choose the scope before publishing.

See [Team knowledge on silverbullet.md](https://silverbullet.md/teams) for a larger team-space example.
