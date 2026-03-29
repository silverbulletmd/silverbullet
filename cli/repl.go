package cli

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/chzyer/readline"
	"github.com/spf13/cobra"
)

func ReplCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "repl",
		Short: "Interactive Lua REPL",
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			return startRepl(conn)
		},
	}
}

func isIncomplete(code string) bool {
	depth := 0
	for _, word := range strings.Fields(code) {
		switch word {
		case "do", "function", "if", "repeat":
			depth++
		case "end", "until":
			depth--
		}
	}
	for _, ch := range code {
		switch ch {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		}
	}
	return depth > 0
}

func startRepl(conn *SpaceConnection) error {
	rl, err := readline.NewEx(&readline.Config{
		Prompt:          "lua> ",
		InterruptPrompt: "^C",
		EOFPrompt:       "",
	})
	if err != nil {
		return err
	}
	defer rl.Close()

	fmt.Println("SilverBullet Lua REPL. Type .exit or Ctrl-D to quit.")

	var scriptMode bool
	var scriptBuffer string
	var multiLineBuffer string

	for {
		line, err := rl.Readline()
		if err == readline.ErrInterrupt {
			if multiLineBuffer != "" || scriptMode {
				multiLineBuffer = ""
				scriptMode = false
				scriptBuffer = ""
				rl.SetPrompt("lua> ")
				continue
			}
			break
		}
		if err == io.EOF {
			break
		}

		trimmed := strings.TrimSpace(line)

		if trimmed == ".exit" {
			break
		}

		if trimmed == ".script" {
			scriptMode = true
			scriptBuffer = ""
			fmt.Println("Entering script mode. Type .end to execute.")
			rl.SetPrompt("...> ")
			continue
		}

		if scriptMode {
			if trimmed == ".end" {
				scriptMode = false
				rl.SetPrompt("lua> ")
				if strings.TrimSpace(scriptBuffer) != "" {
					result, err := conn.EvalLuaScript(scriptBuffer)
					if err != nil {
						fmt.Fprintf(rl.Stderr(), "Error: %s\n", err)
					} else {
						output := formatResult(result)
						if output != "" {
							fmt.Println(output)
						}
					}
				}
				continue
			}
			scriptBuffer += line + "\n"
			continue
		}

		if strings.HasPrefix(trimmed, ".timeout ") {
			var val int
			if _, err := fmt.Sscanf(trimmed, ".timeout %d", &val); err != nil || val <= 0 {
				fmt.Fprintln(rl.Stderr(), "Invalid timeout value")
			} else {
				conn.Timeout = time.Duration(val) * time.Second
				fmt.Printf("Timeout set to %ds\n", val)
			}
			continue
		}

		if multiLineBuffer != "" {
			multiLineBuffer += "\n" + line
		} else {
			multiLineBuffer = line
		}

		if isIncomplete(multiLineBuffer) {
			rl.SetPrompt("...> ")
			continue
		}

		code := multiLineBuffer
		multiLineBuffer = ""
		rl.SetPrompt("lua> ")

		if strings.TrimSpace(code) == "" {
			continue
		}

		isMultiLine := strings.Contains(code, "\n")
		var result any
		if isMultiLine {
			result, err = conn.EvalLuaScript(code)
		} else {
			result, err = conn.EvalLua(code)
		}
		if err != nil {
			fmt.Fprintf(rl.Stderr(), "Error: %s\n", err)
		} else {
			output := formatResult(result)
			if output != "" {
				fmt.Println(output)
			}
		}
	}
	fmt.Println()
	return nil
}
