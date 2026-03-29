package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func ScreenshotCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "screenshot [file]",
		Short: "Capture a screenshot of the headless client",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			png, err := conn.Screenshot()
			if err != nil {
				return err
			}
			if len(args) > 0 {
				if err := os.WriteFile(args[0], png, 0644); err != nil {
					return fmt.Errorf("writing screenshot: %w", err)
				}
			} else {
				os.Stdout.Write(png)
			}
			return nil
		},
	}
}
