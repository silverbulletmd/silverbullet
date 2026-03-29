package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func formatResult(result any) string {
	if result == nil {
		return ""
	}
	if s, ok := result.(string); ok {
		return s
	}
	b, err := json.Marshal(result)
	if err != nil {
		return fmt.Sprintf("%v", result)
	}
	return string(b)
}

func LuaCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "lua <expression>",
		Short: "Evaluate a Lua expression",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			result, err := conn.EvalLua(args[0])
			if err != nil {
				return err
			}
			output := formatResult(result)
			if output != "" {
				if !strings.HasSuffix(output, "\n") {
					output += "\n"
				}
				fmt.Print(output)
			}
			return nil
		},
	}
}

func LuaScriptCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "lua-script [file]",
		Short: "Execute a Lua script from file or stdin",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			var script string
			if len(args) > 0 {
				data, err := os.ReadFile(args[0])
				if err != nil {
					return fmt.Errorf("reading %s: %w", args[0], err)
				}
				script = string(data)
			} else {
				if isTerminal(os.Stdin) {
					fmt.Fprintln(os.Stderr, "Reading from stdin, press Ctrl-D when done.")
				}
				data, err := io.ReadAll(os.Stdin)
				if err != nil {
					return fmt.Errorf("reading stdin: %w", err)
				}
				script = string(data)
			}
			result, err := conn.EvalLuaScript(script)
			if err != nil {
				return err
			}
			output := formatResult(result)
			if output != "" {
				if !strings.HasSuffix(output, "\n") {
					output += "\n"
				}
				fmt.Print(output)
			}
			return nil
		},
	}
}

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
