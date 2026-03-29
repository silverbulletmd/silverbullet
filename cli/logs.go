package cli

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

func LogsCommand() *cobra.Command {
	var lines int
	var follow bool

	cmd := &cobra.Command{
		Use:   "logs",
		Short: "Show console logs from the headless client",
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			logs, err := conn.Logs(lines, 0)
			if err != nil {
				return err
			}
			var lastTimestamp int64
			for _, entry := range logs {
				ts := time.UnixMilli(entry.Timestamp).UTC().Format(time.RFC3339)
				fmt.Printf("%s [%s] %s\n", ts, entry.Level, entry.Text)
				if entry.Timestamp > lastTimestamp {
					lastTimestamp = entry.Timestamp
				}
			}
			if follow {
				for {
					time.Sleep(500 * time.Millisecond)
					newLogs, err := conn.Logs(0, lastTimestamp)
					if err != nil {
						return err
					}
					for _, entry := range newLogs {
						ts := time.UnixMilli(entry.Timestamp).UTC().Format(time.RFC3339)
						fmt.Printf("%s [%s] %s\n", ts, entry.Level, entry.Text)
						if entry.Timestamp > lastTimestamp {
							lastTimestamp = entry.Timestamp
						}
					}
				}
			}
			return nil
		},
	}
	cmd.Flags().IntVarP(&lines, "lines", "n", 100, "Number of log entries to show")
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "Follow log output")
	return cmd
}
