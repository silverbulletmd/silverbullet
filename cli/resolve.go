package cli

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

// AddSpaceFlags adds the common --space, --url, --token, --timeout flags to a command.
func AddSpaceFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().StringP("space", "s", "", "Space to use")
	cmd.PersistentFlags().String("url", "", "Direct URL (skip space lookup)")
	cmd.PersistentFlags().String("token", "", "Direct auth token")
	cmd.PersistentFlags().IntP("timeout", "t", 30, "Request timeout in seconds")
}

// connFromFlags resolves a SpaceConnection from the common flags on the command's root.
func connFromFlags(cmd *cobra.Command) (*SpaceConnection, error) {
	urlFlag, _ := cmd.Flags().GetString("url")
	tokenFlag, _ := cmd.Flags().GetString("token")
	timeoutFlag, _ := cmd.Flags().GetInt("timeout")
	spaceFlag, _ := cmd.Flags().GetString("space")

	timeout := time.Duration(timeoutFlag) * time.Second

	if urlFlag != "" {
		return NewSpaceConnection(ConnectionOpts{
			URL:     urlFlag,
			Token:   tokenFlag,
			Timeout: timeout,
		})
	}

	cfg, err := LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("loading config: %w", err)
	}
	space, err := ResolveSpace(cfg, spaceFlag)
	if err != nil {
		return nil, err
	}
	return NewSpaceConnection(ConnectionOpts{
		Space:   space,
		Timeout: timeout,
	})
}
