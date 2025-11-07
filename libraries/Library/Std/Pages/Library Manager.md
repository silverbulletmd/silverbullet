#meta

The library manager allows you to manage _repositories_ as well as _libraries_.

# Repositories
${widgets.commandButton "Library: Add Repository"} ${widgets.commandButton "Library: Update All Repositories"}
${library.installedRepositoriesWidget()}
# Installed libraries
${widgets.commandButton "Library: Install"} ${widgets.commandButton "Library: Update All"} ${widgets.commandButton "Plugs: Reload"}
${library.installedLibrariesWidget()}
# Available packages
${library.installableLibrariesWidget()}
