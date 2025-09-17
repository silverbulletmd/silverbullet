package cmd

import (
	"io/fs"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/silverbulletmd/silverbullet/pkg/server"
	"github.com/spf13/cobra"
)

func buildConfig(bundledFiles fs.FS, args []string) *server.ServerConfig {
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
	if len(args) > 0 {
		serverConfig.SpaceFolderPath = args[0]
	}
	if os.Getenv("SB_FOLDER") != "" {
		serverConfig.SpaceFolderPath = os.Getenv("SB_FOLDER")
	}

	if serverConfig.SpaceFolderPath == "" {
		log.Fatal("No folder specified. Please pass a folder as an argument or set SB_FOLDER environment variable.")
	}

	var spacePrimitives server.SpacePrimitives
	spacePrimitives, err := server.NewDiskSpacePrimitives(serverConfig.SpaceFolderPath, os.Getenv("SB_GIT_IGNORE"))

	if err != nil {
		log.Fatal(err)
	}

	serverConfig.EnableHTTPLogging = os.Getenv("SB_HTTP_LOGGING") != ""

	if os.Getenv("SB_USER") != "" {
		pieces := strings.Split(os.Getenv("SB_USER"), ":")

		serverConfig.Auth = &server.AuthOptions{
			User:         pieces[0],
			Pass:         pieces[1],
			AuthToken:    os.Getenv("SB_AUTH_TOKEN"),
			LockoutLimit: 10,
			LockoutTime:  60,
		}

		if os.Getenv("SB_LOCKOUT_LIMIT") != "" {
			serverConfig.Auth.LockoutLimit, err = strconv.Atoi(os.Getenv("SB_LOCKOUT_LIMIT"))
			if err != nil {
				log.Fatalf("Could not parse SB_LOCKOUT_LIMIT as number: %v", err)
			}

		}

		if os.Getenv("SB_LOCKOUT_TIME") != "" {
			serverConfig.Auth.LockoutTime, err = strconv.Atoi(os.Getenv("SB_LOCKOUT_TIME"))
			if err != nil {
				log.Fatalf("Could not parse SB_LOCKOUT_TIME as number: %v", err)
			}
		}

		log.Printf("User authentication enabled for user \"%s\" with lockout limit %d and lockout time %ds",
			pieces[0], serverConfig.Auth.LockoutLimit, serverConfig.Auth.LockoutTime)
	}

	serverConfig.ReadOnlyMode = os.Getenv("SB_READ_ONLY") != ""

	if serverConfig.ReadOnlyMode {
		log.Println("Starting in read-only mode.")
	}

	serverConfig.GitIgnore = os.Getenv("SB_GIT_IGNORE")

	if os.Getenv("SB_SPACE_IGNORE") != "" {
		log.Printf("Ignoring files matching: %s", os.Getenv("SB_SPACE_IGNORE"))
	}

	if os.Getenv("SB_URL_PREFIX") != "" {
		hostUrlPrefix := os.Getenv("SB_URL_PREFIX")
		// Normalize the host URL prefix (if set)
		if !strings.HasPrefix(hostUrlPrefix, "/") {
			hostUrlPrefix = "/" + hostUrlPrefix
		}
		hostUrlPrefix = strings.TrimRight(hostUrlPrefix, "/")

		if hostUrlPrefix != "" {
			log.Printf("Host URL Prefix: %s", hostUrlPrefix)
			serverConfig.HostURLPrefix = hostUrlPrefix
		}
	}

	serverConfig.ClientBundle = server.NewReadOnlyFallthroughSpacePrimitives(bundledFiles, "dist_client_bundle", time.Now(), nil)
	serverConfig.SpacePrimitives = server.NewReadOnlyFallthroughSpacePrimitives(bundledFiles, "dist_plug_bundle", time.Now(), spacePrimitives)

	log.Printf("Starting SilverBullet binding to %s:%d", serverConfig.Hostname, serverConfig.Port)
	if serverConfig.Hostname == "127.0.0.1" {
		log.Println("SilverBullet will only be available locally, to allow outside connections, pass -L0.0.0.0 as a flag, and put a TLS terminator on top.")
	}

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

	return serverConfig
}

func ServerCommand(bundledFiles fs.FS) *cobra.Command {
	var userPass string
	var hostname string
	var port int
	var c = &cobra.Command{
		Use:   "silverbullet [path]",
		Short: "Run the Silverbullet server",
		Run: func(cmd *cobra.Command, args []string) {
			serverConfig := buildConfig(bundledFiles, args)
			if err := server.RunServer(serverConfig); err != nil {
				log.Fatal(err)
			}
		},
	}
	c.Flags().StringVarP(&userPass, "user", "", "", "user:pass authentication info")
	c.Flags().StringVarP(&hostname, "hostname", "L", "127.0.0.1", "Host or address to listen to")
	c.Flags().IntVarP(&port, "port", "p", 3000, "Port to listen to")

	return c
}
