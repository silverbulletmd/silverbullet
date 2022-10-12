Work on the `mattermost-plugin` — integration of SB into Mattermost as a
product/plugin as a proof of concept.

To do:

- [ ] Bundle backend with node.js as part of plugin
  - Various options investigated, including [nexe](https://github.com/nexe/nexe)
    and [pkg](https://github.com/vercel/pkg) but neither of these will work
    great due to dynamically loading and resolving of modules in the node.js
    sandbox implementation.
  - Most straight-forward option is to simply bundle the `node` binary per
    platform + a trimmed down `node_modules` modeled how `npx` does this. Once
    per platform.
- [ ] Fix CSS styling issues
- [ ] Store pages in DB instead of text files (general SB feature, not MM
      specific)
- [ ] Switch over SB plugin to use MM database (MySQL, Postgres) as backing
      store rather than SQLite
- [ ] Freeze plug configuration (don’t allow anybody or at most admins) to
      update plugs for security reasons. We may simply remove the `PLUGS` page.
  - What about `SETTINGS`?
    - Easy option: disable, don’t use
    - Fancier option: make them user specific with a layer on top of the FS
  - What about `SECRETS`?

To deliberate on:

- Consider page locking mechanisms, or re-implement real-time collaboration
  (would require introducing web sockets again and OT) — big project.
- Consider page revision options
- Scope of spaces, tied to:
  - Personal (default SB PKMS use case, no permission, collaboration issues)
  - Channel (old Boards model)
  - Team
  - Server
