package cli

import (
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
)

// readStdin reads all of stdin, printing a hint if the input is a terminal.
func readStdin() (string, error) {
	if isTerminal(os.Stdin) {
		fmt.Fprintln(os.Stderr, "Reading from stdin, press Ctrl-D when done.")
	}
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("reading stdin: %w", err)
	}
	return string(data), nil
}

// evalAndFormat runs a Lua script via conn and formats the output.
func evalAndFormat(cmd *cobra.Command, conn *SpaceConnection, script string) error {
	result, err := conn.EvalLuaScript(script)
	if err != nil {
		return err
	}
	return FormatOutput(os.Stdout, result, OutputModeFromCmd(cmd))
}

func EvalCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "eval <expression>",
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
			return FormatOutput(os.Stdout, result, OutputModeFromCmd(cmd))
		},
	}
	return cmd
}

// LuaCommand returns a hidden alias for EvalCommand (backward compat).
func LuaCommand() *cobra.Command {
	cmd := EvalCommand()
	cmd.Use = "lua <expression>"
	cmd.Hidden = true
	return cmd
}

func ScriptCommand() *cobra.Command {
	var filePath string
	cmd := &cobra.Command{
		Use:   "script [code]",
		Short: "Execute a Lua script from inline code, file, or stdin",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			var script string
			if filePath != "" {
				data, err := os.ReadFile(filePath)
				if err != nil {
					return fmt.Errorf("reading %s: %w", filePath, err)
				}
				script = string(data)
			} else if len(args) > 0 {
				script = args[0]
			} else {
				script, err = readStdin()
				if err != nil {
					return err
				}
			}
			return evalAndFormat(cmd, conn, script)
		},
	}
	cmd.Flags().StringVarP(&filePath, "file", "f", "", "Read script from file")
	return cmd
}

// LuaScriptCommand returns a hidden alias preserving old behavior:
// positional arg is a file path (not inline code).
func LuaScriptCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:    "lua-script [file]",
		Short:  "Execute a Lua script from file or stdin",
		Args:   cobra.MaximumNArgs(1),
		Hidden: true,
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
				script, err = readStdin()
				if err != nil {
					return err
				}
			}
			return evalAndFormat(cmd, conn, script)
		},
	}
	return cmd
}

func QueryCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "query <sliq-expression>",
		Short: "Run a query (wraps in query[[...]])",
		Long:  "Evaluate a Space Lua Integrated Query. The argument is the query body.\nExample: silverbullet-cli query 'from t = index.tag \"task\" where not t.done'",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			return evalAndFormat(cmd, conn, "return query[["+args[0]+"]]")
		},
	}
	return cmd
}

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
