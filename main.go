package main

import (
	"embed"

	"github.com/silverbulletmd/silverbullet/server_go"
)

//go:embed dist_client_bundle/*
//go:embed dist_plug_bundle/*
var bundledFiles embed.FS

func main() {
	server_go.RunServer(bundledFiles)
}
