package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLocalShell_HandleValidCommand(t *testing.T) {
	tmpDir := t.TempDir()
	shell := NewLocalShell(tmpDir, "") // No whitelist = allow all commands

	request := ShellRequest{
		Cmd:  "echo",
		Args: []string{"Hello World"},
	}

	response, err := shell.Handle(request)
	assert.NoError(t, err, "Should handle valid command without error")
	assert.Equal(t, 0, response.Code, "Echo command should exit with code 0")
	assert.Equal(t, "Hello World\n", response.Stdout, "Should return stdout")
	assert.Empty(t, response.Stderr, "Should have empty stderr")
}

func TestLocalShell_HandleCommandWithStdin(t *testing.T) {
	tmpDir := t.TempDir()
	shell := NewLocalShell(tmpDir, "")

	input := "test input"
	request := ShellRequest{
		Cmd:   "cat",
		Args:  []string{},
		Stdin: &input,
	}

	response, err := shell.Handle(request)
	assert.NoError(t, err, "Should handle command with stdin without error")
	assert.Equal(t, 0, response.Code, "cat command should exit with code 0")
	assert.Equal(t, "test input", response.Stdout, "Should echo stdin to stdout")
	assert.Empty(t, response.Stderr, "Should have empty stderr")
}

func TestLocalShell_HandleWorkingDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	shell := NewLocalShell(tmpDir, "")

	// Create a test file in the temp directory
	testFile := filepath.Join(tmpDir, "test.txt")
	err := os.WriteFile(testFile, []byte("test content"), 0644)
	assert.NoError(t, err, "Should create test file")

	request := ShellRequest{
		Cmd:  "ls",
		Args: []string{},
	}

	response, err := shell.Handle(request)
	assert.NoError(t, err, "Should handle ls command without error")
	assert.Equal(t, 0, response.Code, "ls command should exit with code 0")
	assert.Contains(t, response.Stdout, "test.txt", "Should list the test file")
	assert.Empty(t, response.Stderr, "Should have empty stderr")
}

func TestLocalShell_HandleWithWhitelist(t *testing.T) {
	tmpDir := t.TempDir()
	shell := NewLocalShell(tmpDir, "echo,pwd")

	// Test allowed command
	request := ShellRequest{
		Cmd:  "echo",
		Args: []string{"allowed"},
	}

	response, err := shell.Handle(request)
	assert.NoError(t, err, "Should handle whitelisted command without error")
	assert.Equal(t, 0, response.Code, "Whitelisted command should succeed")
	assert.Equal(t, "allowed\n", response.Stdout, "Should return expected output")

	// Test disallowed command
	request = ShellRequest{
		Cmd:  "ls",
		Args: []string{},
	}

	response, err = shell.Handle(request)
	assert.NoError(t, err, "Should handle request without error")
	assert.Equal(t, -1, response.Code, "Non-whitelisted command should return -1")
	assert.Empty(t, response.Stdout, "Should have empty stdout")
	assert.Equal(t, "Not allowed, command not in whitelist", response.Stderr, "Should return whitelist error")
}

func TestLocalShell_HandleCommandWithBothStreams(t *testing.T) {
	tmpDir := t.TempDir()
	shell := NewLocalShell(tmpDir, "")

	// Create a shell script that outputs to both stdout and stderr
	script := `#!/bin/sh
echo "stdout message"
echo "stderr message" >&2
exit 0`

	scriptPath := filepath.Join(tmpDir, "test_script.sh")
	err := os.WriteFile(scriptPath, []byte(script), 0755)
	assert.NoError(t, err, "Should create test script")

	request := ShellRequest{
		Cmd:  "sh",
		Args: []string{scriptPath},
	}

	response, err := shell.Handle(request)
	assert.NoError(t, err, "Should handle script without error")
	assert.Equal(t, 0, response.Code, "Script should exit with code 0")
	assert.Equal(t, "stdout message\n", response.Stdout, "Should capture stdout")
	assert.Equal(t, "stderr message\n", response.Stderr, "Should capture stderr")
}

func TestLocalShell_WhitelistWithSpaces(t *testing.T) {
	tmpDir := t.TempDir()
	// Test that paths with spaces are supported when using comma delimiter
	shell := NewLocalShell(tmpDir, "/usr/local/bin/git,/Program Files/Git/bin/git.exe, echo ")

	// Verify the whitelist was parsed correctly
	assert.Equal(t, 3, len(shell.CmdWhiteList), "Should parse 3 commands")
	assert.Equal(t, "/usr/local/bin/git", shell.CmdWhiteList[0], "Should preserve path with slashes")
	assert.Equal(t, "/Program Files/Git/bin/git.exe", shell.CmdWhiteList[1], "Should preserve path with spaces")
	assert.Equal(t, "echo", shell.CmdWhiteList[2], "Should trim whitespace")
	assert.False(t, shell.AllowAllCmds, "Should not allow all commands when whitelist is set")
}

func TestLocalShell_WhitelistWithExtraWhitespace(t *testing.T) {
	tmpDir := t.TempDir()
	// Test that extra whitespace is trimmed
	shell := NewLocalShell(tmpDir, " echo , pwd , ls")

	assert.Equal(t, 3, len(shell.CmdWhiteList), "Should parse 3 commands")
	assert.Equal(t, "echo", shell.CmdWhiteList[0], "Should trim leading/trailing whitespace")
	assert.Equal(t, "pwd", shell.CmdWhiteList[1], "Should trim leading/trailing whitespace")
	assert.Equal(t, "ls", shell.CmdWhiteList[2], "Should trim leading/trailing whitespace")
}

func TestLocalShell_EmptyWhitelist(t *testing.T) {
	tmpDir := t.TempDir()
	shell := NewLocalShell(tmpDir, "")

	assert.Equal(t, 0, len(shell.CmdWhiteList), "Empty whitelist should have no entries")
	assert.True(t, shell.AllowAllCmds, "Empty whitelist should allow all commands")
}

func TestLocalShell_WhitelistWithEmptyEntries(t *testing.T) {
	tmpDir := t.TempDir()
	// Test that empty entries (between commas) are ignored
	shell := NewLocalShell(tmpDir, "echo,,pwd,  ,ls")

	assert.Equal(t, 3, len(shell.CmdWhiteList), "Should skip empty entries")
	assert.Equal(t, "echo", shell.CmdWhiteList[0])
	assert.Equal(t, "pwd", shell.CmdWhiteList[1])
	assert.Equal(t, "ls", shell.CmdWhiteList[2])
}
