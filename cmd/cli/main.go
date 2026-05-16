package main

import (
	"github.com/silverbulletmd/silverbullet/cli"
	"github.com/spf13/cobra"
)

// Set via -ldflags "-X main.version=..."
var version string

func main() {
	root := &cobra.Command{
		Use:   "sb",
		Short: "SilverBullet CLI",
		Long:  "SilverBullet CLI — interact with your spaces from the command line.\n\nRun 'sb describe' to see available data types and query syntax.",
	}

	cli.AddSpaceFlags(root)
	cli.AddOutputFlags(root)

	root.AddCommand(
		cli.SpaceCommand(),
		cli.EvalCommand(),
		cli.LuaCommand(),       // hidden alias
		cli.ScriptCommand(),
		cli.LuaScriptCommand(), // hidden alias
		cli.QueryCommand(),
		cli.GetCommand(),
		cli.DescribeCommand(),
		cli.LogsCommand(),
		cli.ScreenshotCommand(),
		cli.ReplCommand(),
		cli.VersionCommand(version),
		cli.UpgradeCommand(),
		cli.UpgradeEdgeCommand(),
	)

	root.Execute()
}
