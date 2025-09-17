package main

import (
	"embed"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/silverbulletmd/silverbullet/pkg/server"
)

// Embed the client and plug bundles into the Go binary
//
//go:embed dist_client_bundle/*
//go:embed dist_plug_bundle/*
var bundledFiles embed.FS

func main() {
	serverConfig := &server.ServerConfig{
		IndexPage: "index",
		Port:      3000,
		Hostname:  "127.0.0.1",
	}

	if os.Getenv("SB_HOSTNAME") != "" {
		serverConfig.Hostname = os.Getenv("SB_HOSTNAME")
	}

	if os.Getenv("SB_PORT") != "" {
		// Parse integer from string
		port, err := strconv.ParseInt(os.Getenv("SB_PORT"), 10, 32)
		if err != nil {
			log.Fatalf("Could not parse numeric port from SB_PORT: %v", err)
		}
		serverConfig.Port = int(port)
	}

	if os.Getenv("SB_INDEX_PAGE") != "" {
		serverConfig.IndexPage = os.Getenv("SB_INDEX_PAGE")
	}
	if len(os.Args) > 0 {
		serverConfig.SpaceFolderPath = os.Args[1]
	}
	if os.Getenv("SB_FOLDER_PATH") != "" {
		serverConfig.SpaceFolderPath = os.Getenv("SB_FOLDER_PATH")
	}
	if serverConfig.SpaceFolderPath == "" {
		log.Fatal("No space folder path specified")
	}

	var spacePrimitives server.SpacePrimitives
	spacePrimitives, err := server.NewDiskSpacePrimitives(serverConfig.SpaceFolderPath, os.Getenv("SB_GIT_IGNORE"))

	if err != nil {
		log.Fatal(err)
	}

	if os.Getenv("SB_USER") != "" {
		pieces := strings.Split(os.Getenv("SB_USER"), ":")
		serverConfig.Auth = &server.AuthOptions{
			User: pieces[0],
			Pass: pieces[1],
		}
	}
	serverConfig.ReadOnlyMode = os.Getenv("SB_READ_ONLY") != ""
	serverConfig.GitIgnore = os.Getenv("SB_GIT_IGNORE")

	serverConfig.ClientBundle = server.NewReadOnlyFallthroughSpacePrimitives(bundledFiles, "dist_client_bundle", time.Now(), nil)
	serverConfig.SpacePrimitives = server.NewReadOnlyFallthroughSpacePrimitives(bundledFiles, "dist_plug_bundle", time.Now(), spacePrimitives)

	// Initialize shell backend
	backendConfig := os.Getenv("SB_SHELL_BACKEND")
	if backendConfig == "" && !serverConfig.ReadOnlyMode {
		localShell := server.NewLocalShell(serverConfig.SpaceFolderPath, os.Getenv("SB_SHELL_WHITELIST"))
		serverConfig.ShellBackend = localShell
		if localShell.AllowAllCmds {
			log.Println("Local shell command execution enabled for ALL commands.")
		} else {
			log.Printf("Local shell command execution enabled for: %v", localShell.CmdWhiteList)
		}
	} else {
		log.Println("Shell running disabled.")
		serverConfig.ShellBackend = server.NewNotSupportedShell()
	}

	if err := server.RunServer(serverConfig); err != nil {
		panic(err)
	}
}
