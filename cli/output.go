package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

type OutputMode int

const (
	OutputJSON OutputMode = iota
	OutputText
)

// ResolveOutputMode determines output format from flags and TTY state.
// Precedence: explicit flag > TTY detection.
func ResolveOutputMode(jsonFlag, textFlag, isTTY bool) OutputMode {
	if jsonFlag {
		return OutputJSON
	}
	if textFlag {
		return OutputText
	}
	if isTTY {
		return OutputText
	}
	return OutputJSON
}

// FormatOutput writes result to w in the given mode.
// Returns nil and writes nothing if result is nil.
func FormatOutput(w io.Writer, result any, mode OutputMode) error {
	if result == nil {
		return nil
	}

	var output string
	switch mode {
	case OutputJSON:
		b, err := json.Marshal(result)
		if err != nil {
			return err
		}
		output = string(b)
	case OutputText:
		if s, ok := result.(string); ok {
			output = s
		} else {
			b, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				return err
			}
			output = string(b)
		}
	}

	if output != "" {
		if !strings.HasSuffix(output, "\n") {
			output += "\n"
		}
		_, err := fmt.Fprint(w, output)
		return err
	}
	return nil
}

// AddOutputFlags adds --json and --text flags to a command.
func AddOutputFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().Bool("json", false, "Force JSON output")
	cmd.PersistentFlags().Bool("text", false, "Force human-readable output")
}

// OutputModeFromCmd resolves the output mode from command flags and stdout TTY state.
func OutputModeFromCmd(cmd *cobra.Command) OutputMode {
	jsonFlag, _ := cmd.Flags().GetBool("json")
	textFlag, _ := cmd.Flags().GetBool("text")
	isTTY := isTerminal(os.Stdout)
	return ResolveOutputMode(jsonFlag, textFlag, isTTY)
}
