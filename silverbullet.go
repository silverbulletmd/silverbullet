package main

import (
	_ "embed"

	"github.com/silverbulletmd/silverbullet/client_bundle"
	"github.com/silverbulletmd/silverbullet/server/cmd"
)

//go:embed public_version.ts
var VersionFileText string

// Set via LDFLAGS
var buildTime string

func main() {
	c := cmd.ServerCommand(client_bundle.BundledFiles, VersionFileText, buildTime)
	c.AddCommand(cmd.VersionCommand(VersionFileText), cmd.UpgradeCommand(), cmd.UpgradeEdgeCommand())
	c.Execute()
}
