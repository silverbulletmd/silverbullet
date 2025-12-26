package server

import (
	"bytes"
	"log"
	"os/exec"
	"slices"
	"strings"
)

// LocalShell implements shell execution on the local system
type LocalShell struct {
	Cwd          string
	CmdWhiteList []string
	AllowAllCmds bool
}

// NewLocalShell creates a new LocalShell instance
func NewLocalShell(cwd string, cmdWhiteList string) *LocalShell {
	var whiteListedCommands []string
	if cmdWhiteList == "" {
		whiteListedCommands = []string{}
	} else {
		// Use comma as delimiter to support paths with spaces
		parts := strings.Split(cmdWhiteList, ",")
		for _, part := range parts {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				whiteListedCommands = append(whiteListedCommands, trimmed)
			}
		}
	}
	return &LocalShell{
		Cwd:          cwd,
		CmdWhiteList: whiteListedCommands,
		AllowAllCmds: len(whiteListedCommands) == 0,
	}
}

// Handle executes a shell command and returns the result
func (ls *LocalShell) Handle(request ShellRequest) (ShellResponse, error) {
	// Check if command is whitelisted
	if !ls.AllowAllCmds && !slices.Contains(ls.CmdWhiteList, request.Cmd) {
		log.Printf("Not running shell command because not in whitelist: %s\n", request.Cmd)
		return ShellResponse{
			Code:   -1,
			Stdout: "",
			Stderr: "Not allowed, command not in whitelist",
		}, nil
	}

	log.Printf("Running shell command: %s %s\n", request.Cmd, strings.Join(request.Args, " "))

	// Create the command
	cmd := exec.Command(request.Cmd, request.Args...)
	cmd.Dir = ls.Cwd

	// Set up stdin if provided
	if request.Stdin != nil {
		cmd.Stdin = strings.NewReader(*request.Stdin)
	}

	// Set up separate buffers for stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Execute the command
	err := cmd.Run()

	var exitCode int
	if err != nil {
		// Try to get the exit code
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		} else {
			// Command failed to start
			return ShellResponse{
				Code:   -1,
				Stdout: "",
				Stderr: err.Error(),
			}, nil
		}
	}

	return ShellResponse{
		Code:   exitCode,
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}, nil
}

// NotSupportedShell implements a shell backend that doesn't support execution
type NotSupportedShell struct{}

// NewNotSupportedShell creates a new NotSupportedShell instance
func NewNotSupportedShell() *NotSupportedShell {
	return &NotSupportedShell{}
}

// Handle always returns a "not supported" error
func (nss *NotSupportedShell) Handle(request ShellRequest) (ShellResponse, error) {
	return ShellResponse{
		Code:   1,
		Stdout: "",
		Stderr: "Not supported",
	}, nil
}
