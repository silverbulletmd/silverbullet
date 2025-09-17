package main

import (
	"embed"

	"github.com/silverbulletmd/silverbullet/pkg/server/cmd"
)

// Embed client files, plugs and version files into the binary
//
//go:embed dist_client_bundle/*
//go:embed dist_plug_bundle/*
var bundledFiles embed.FS

//go:embed public_version.ts
var versionFileText string

func main() {
	c := cmd.ServerCommand(bundledFiles)
	c.AddCommand(cmd.VersionCommand(versionFileText), cmd.UpgradeCommand(), cmd.UpgradeEdgeCommand())
	c.Execute()
}
