Change a setting, install a library or try a small expression in your own writable space. The published documentation is read-only. Open the command palette with **Cmd-/ / Ctrl-/** to run the commands below.

# Change a setting
Run `Workbench: Configuration`, or press **Cmd-, / Ctrl-,**. Find an option using the filter and change its control. Click **Save and apply** to save the change in your space’s CONFIG page and apply it. **Discard** abandons pending changes; closing Workbench alone does not discard them.

Use the option’s ⋯ menu and **Reset to default**, then save again, to remove your override. [[Workbench/Configuration]] describes key bindings, pending edits and settings that need manual configuration.

# Install a library
Run `Workbench: Libraries`. Under **Available**, choose a library and click **Install**. If you have a library URI instead, click **Install…** and enter its `https://…` or `github:…` address. Use a source you trust: a library can install code that runs in your space.

Look for the library under **Installed**. Its menu offers **Remove** when you want to uninstall it. Use **Check for updates** to compare installed libraries with their sources, then choose an update. [[Workbench/Libraries]] explains repositories, update conflicts and built-in libraries.

# Try an expression
Run `Workbench: Console`, enter `1 + 2`, and press Enter. The result is `3`. This experiment does not change your notes. Other expressions can write to your space when they call a write API; inspect what they do before running them.

[[Workbench/Console]] explains results and errors. Use [[Reference]] for configuration options, Space Lua and extension APIs when you need to build your own customization.
