package main

import (
	"embed"
	"os"
	"time"

	"github.com/silverbulletmd/silverbullet/pkg/server"
)

//go:embed dist_client_bundle/*
//go:embed dist_plug_bundle/*
var bundledFiles embed.FS

func main() {
	indexPage := "index"
	if os.Getenv("SB_INDEX_PAGE") != "" {
		indexPage = os.Getenv("SB_INDEX_PAGE")
	}
	spaceFolder := ""
	if len(os.Args) > 0 {
		spaceFolder = os.Args[1]
	}
	if os.Getenv("SB_FOLDER_PATH") != "" {
		spaceFolder = os.Getenv("SB_FOLDER_PATH")
	}

	var spacePrimitives server.SpacePrimitives
	spacePrimitives, err := server.NewDiskSpacePrimitives(spaceFolder, os.Getenv("SB_GIT_IGNORE"))

	if err != nil {
		panic(err)
	}

	clientBundle := server.NewReadOnlyFallthroughSpacePrimitives(bundledFiles, "dist_client_bundle", time.Now(), nil)
	spacePrimitives = server.NewReadOnlyFallthroughSpacePrimitives(bundledFiles, "dist_plug_bundle", time.Now(), spacePrimitives)

	server.RunServer(&server.ServerConfig{
		SpaceFolderPath: spaceFolder,
		SpacePrimitives: spacePrimitives,
		IndexPage:       indexPage,
		GitIgnore:       os.Getenv("SB_GIT_IGNORE"),
		ReadOnlyMode:    os.Getenv("SB_READ_ONLY") != "",
		ClientBundle:    clientBundle,
	})
}
