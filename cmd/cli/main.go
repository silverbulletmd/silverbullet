package main

import (
	"github.com/silverbulletmd/silverbullet/cli"
	"github.com/spf13/cobra"
)

// Set via -ldflags "-X main.version=..."
var version string

func main() {
	root := &cobra.Command{
		Use:   "silverbullet-cli",
		Short: "SilverBullet CLI",
	}

	cli.AddSpaceFlags(root)

	root.AddCommand(
		cli.SpaceCommand(),
		cli.LuaCommand(),
		cli.LuaScriptCommand(),
		cli.LogsCommand(),
		cli.ScreenshotCommand(),
		cli.ReplCommand(),
		cli.VersionCommand(version),
		cli.UpgradeCommand(),
		cli.UpgradeEdgeCommand(),
	)

	root.Execute()
}
