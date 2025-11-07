#meta

The library manager allows you to manage _repositories_ as well as _libraries_.

# Repositories
Repositories contain references to installable repositories.

${widgets.commandButton "Library: Add Repository"} ${widgets.commandButton "Library: Update All Repositories"}
${library.installedRepositoriesWidget()}
# Installed libraries
${widgets.commandButton "Library: Update All"}
${library.installedLibrariesWidget()}
# Available packages
${library.installableLibrariesWidget()}
