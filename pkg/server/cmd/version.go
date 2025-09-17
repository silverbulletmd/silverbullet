package cmd

import (
	"fmt"
	"log"

	"github.com/silverbulletmd/silverbullet/pkg/server"
	"github.com/spf13/cobra"
)

func VersionCommand(versionFileText string) *cobra.Command {
	return &cobra.Command{
		Use: "version",
		Run: func(cmd *cobra.Command, args []string) {
			version, err := server.ParseVersionFromTypeScript(versionFileText)
			if err != nil {
				log.Fatal(err)
			}
			fmt.Println(version)
		},
	}
}
