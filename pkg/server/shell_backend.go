package server

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"
)

// LocalShell implements shell execution on the local system
type LocalShell struct {
	cwd          string
	cmdWhiteList []string
	allowAllCmds bool
}

// NewLocalShell creates a new LocalShell instance
func NewLocalShell(cwd string, cmdWhiteList []string) *LocalShell {
	return &LocalShell{
		cwd:          cwd,
		cmdWhiteList: cmdWhiteList,
		allowAllCmds: len(cmdWhiteList) == 0,
	}
}

// Handle executes a shell command and returns the result
func (ls *LocalShell) Handle(request ShellRequest) (ShellResponse, error) {
	// Check if command is whitelisted
	if !ls.allowAllCmds && !slices.Contains(ls.cmdWhiteList, request.Cmd) {
		fmt.Printf("Not running shell command because not in whitelist: %s\n", request.Cmd)
		return ShellResponse{
			Code:   -1,
			Stdout: "",
			Stderr: "Not allowed, command not in whitelist",
		}, nil
	}

	fmt.Printf("Running shell command: %s %s\n", request.Cmd, strings.Join(request.Args, " "))

	// Create the command
	cmd := exec.Command(request.Cmd, request.Args...)
	cmd.Dir = ls.cwd

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

// DetermineShellBackend creates the appropriate shell backend based on configuration
func DetermineShellBackend(config *ServerConfig) ShellBackend {
	backendConfig := config.ShellBackend
	if backendConfig == "" {
		backendConfig = os.Getenv("SB_SHELL_BACKEND")
		if backendConfig == "" {
			backendConfig = "local"
		}
		if os.Getenv("SB_READ_ONLY_MODE") != "" {
			backendConfig = "disabled"
		}
	}

	switch backendConfig {
	case "local":
		if len(config.ShellCommandWhiteList) > 0 {
			fmt.Printf("Running with the following shell commands enabled: %v\n", config.ShellCommandWhiteList)
		} else {
			fmt.Println("Running with ALL shell commands enabled.")
		}
		return NewLocalShell(config.SpaceFolderPath, config.ShellCommandWhiteList)
	default:
		fmt.Println("Running in shell-less mode, meaning shell commands are disabled")
		return NewNotSupportedShell()
	}
}
