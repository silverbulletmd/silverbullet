package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/silverbulletmd/silverbullet/server"
	"github.com/silverbulletmd/silverbullet/server/servertest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	cliBinary string
	serverURL string
)

func TestMain(m *testing.M) {
	// Build the Core CLI binary once for all tests.
	tmp, err := os.MkdirTemp("", "sb-cli-test-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tmp)

	cliBinary = filepath.Join(tmp, "silverbullet-cli")

	_, thisFile, _, _ := runtime.Caller(0)
	cliDir := filepath.Join(filepath.Dir(filepath.Dir(thisFile)), "cmd", "cli")

	cmd := exec.Command("go", "build", "-o", cliBinary, ".")
	cmd.Dir = cliDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		panic("failed to build CLI binary: " + err.Error())
	}

	// Start a single shared headless server for all integration tests.
	ts, cleanup := startSharedServer()
	serverURL = ts.Server.URL

	code := m.Run()
	cleanup()
	os.Exit(code)
}

func startSharedServer() (*servertest.TestServer, func()) {
	// We can't use testing.T here (TestMain), so we set up manually.
	t := &testing.T{} // dummy for servertest.NewTestServer's require calls
	ts := servertest.NewTestServer(t, servertest.WithRuntimeAPI())

	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("failed to generate headless token: " + err.Error())
	}
	ts.Config.HeadlessToken = hex.EncodeToString(b)

	hb, err := server.StartHeadlessBrowser(&server.HeadlessConfig{
		ServerURL:     ts.Server.URL,
		HeadlessToken: ts.Config.HeadlessToken,
	})
	if err != nil {
		panic("headless browser should start: " + err.Error())
	}

	readyCtx, readyCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer readyCancel()
	if err := hb.WaitReady(readyCtx); err != nil {
		panic("headless browser client should become ready: " + err.Error())
	}

	ts.Config.RuntimeBridge.SetBrowser(hb)

	return ts, func() {
		hb.Stop()
		ts.Server.Close()
	}
}

// runCLI executes the CLI binary with the given output mode flag and returns stdout.
func runCLI(t *testing.T, mode string, args ...string) string {
	t.Helper()
	fullArgs := append([]string{"--url", serverURL, mode}, args...)
	cmd := exec.Command(cliBinary, fullArgs...)
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "CLI failed: %s\nargs: %v", string(out), fullArgs)
	return string(out)
}

func TestIntegration_Eval(t *testing.T) {
	out := runCLI(t, "--json", "eval", "1 + 1")
	assert.Equal(t, "2\n", out)

	out = runCLI(t, "--json", "eval", `"hello " .. "world"`)
	assert.Equal(t, "\"hello world\"\n", out)

	out = runCLI(t, "--text", "eval", `"hello " .. "world"`)
	assert.Equal(t, "hello world\n", out)
}

func TestIntegration_Script(t *testing.T) {
	out := runCLI(t, "--json", "script", "local x = 10\nlocal y = 20\nreturn x + y")
	assert.Equal(t, "30\n", out)
}

func TestIntegration_Script_File(t *testing.T) {
	tmp := t.TempDir()
	scriptFile := filepath.Join(tmp, "test.lua")
	err := os.WriteFile(scriptFile, []byte("return 42"), 0644)
	require.NoError(t, err)

	out := runCLI(t, "--json", "script", "-f", scriptFile)
	assert.Equal(t, "42\n", out)
}

func TestIntegration_Query_Pages(t *testing.T) {
	out := runCLI(t, "--json", "query", `
		from p = index.tag "page"
		where not p.name:startsWith("Library/")
		order by p.name asc
		select table.select(p, "name", "tags")
	`)

	var pages []map[string]any
	require.NoError(t, json.Unmarshal([]byte(out), &pages))
	require.True(t, len(pages) > 0, "expected at least one page")

	found := false
	for _, p := range pages {
		if p["name"] == "index" {
			found = true
			break
		}
	}
	assert.True(t, found, "expected to find 'index' page")
}

func TestIntegration_Query_Tasks(t *testing.T) {
	out := runCLI(t, "--json", "query", `
		from t = index.tag "task"
		select table.select(t, "name", "done", "page")
	`)

	var tasks []map[string]any
	require.NoError(t, json.Unmarshal([]byte(out), &tasks))
	require.True(t, len(tasks) >= 3, "expected at least 3 tasks from Project Alpha")

	doneCount := 0
	for _, task := range tasks {
		if done, ok := task["done"].(bool); ok && done {
			doneCount++
		}
	}
	assert.True(t, doneCount >= 1, "expected at least 1 completed task")
}

func TestIntegration_Describe(t *testing.T) {
	out := runCLI(t, "--json", "describe")

	var result map[string]any
	require.NoError(t, json.Unmarshal([]byte(out), &result))

	tags, ok := result["tags"].([]any)
	require.True(t, ok, "expected tags array in describe output")

	tagNames := make([]string, 0, len(tags))
	for _, ti := range tags {
		tag, ok := ti.(map[string]any)
		if !ok {
			continue
		}
		if name, ok := tag["name"].(string); ok {
			tagNames = append(tagNames, name)
		}
	}
	assert.Contains(t, tagNames, "page")
	assert.Contains(t, tagNames, "task")
	assert.Contains(t, tagNames, "item")
	assert.Contains(t, tagNames, "link")

	syntax, ok := result["syntax"].(string)
	assert.True(t, ok && syntax != "", "expected syntax reference in describe output")
	assert.Contains(t, syntax, "from <var> = index.tag")
}

func TestIntegration_Describe_Tag(t *testing.T) {
	out := runCLI(t, "--json", "describe", "task")

	var result map[string]any
	require.NoError(t, json.Unmarshal([]byte(out), &result))

	assert.Equal(t, "task", result["name"])

	props, ok := result["properties"].([]any)
	require.True(t, ok, "expected properties array")

	propNames := make([]string, 0, len(props))
	for _, p := range props {
		prop, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if name, ok := prop["name"].(string); ok {
			propNames = append(propNames, name)
		}
	}
	assert.Contains(t, propNames, "done")
	assert.Contains(t, propNames, "name")
	assert.Contains(t, propNames, "page")
	assert.Contains(t, propNames, "state")
}

func TestIntegration_Describe_Text(t *testing.T) {
	out := runCLI(t, "--text", "describe")
	assert.Contains(t, out, "SilverBullet Query Reference")
	assert.Contains(t, out, "Available object types:")
	assert.Contains(t, out, "page")
	assert.Contains(t, out, "task")
	assert.Contains(t, out, "from <var> = index.tag")
}

func TestIntegration_SLIQ_Reference_Page(t *testing.T) {
	out := runCLI(t, "--text", "script", `return space.readPage("Library/Std/Docs/SLIQ Reference")`)
	assert.Contains(t, out, "from <var> = index.tag")
	assert.Contains(t, out, "table.select")
	assert.Contains(t, out, "array_agg")
}

func TestIntegration_BackwardCompat_Lua(t *testing.T) {
	out := runCLI(t, "--json", "lua", "1 + 1")
	assert.Equal(t, "2\n", out)
}

func TestIntegration_BackwardCompat_LuaScript(t *testing.T) {
	tmp := t.TempDir()
	scriptFile := filepath.Join(tmp, "test.lua")
	err := os.WriteFile(scriptFile, []byte("return 99"), 0644)
	require.NoError(t, err)

	out := runCLI(t, "--json", "lua-script", scriptFile)
	assert.Equal(t, "99\n", out)
}

func TestIntegration_NilResult(t *testing.T) {
	out := runCLI(t, "--json", "script", "local x = 1")
	assert.Equal(t, "", out, "nil result should produce no output")
}

func TestIntegration_OutputAutoDetect(t *testing.T) {
	// Run without --json or --text flags; non-TTY should default to JSON
	cmd := exec.Command(cliBinary, "--url", serverURL, "eval", "1 + 1")
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "CLI failed: %s", string(out))
	assert.Equal(t, "2\n", string(out))
}

func TestIntegration_BadURL(t *testing.T) {
	cmd := exec.Command(cliBinary, "--url", "http://127.0.0.1:1", "--timeout", "2", "eval", "1")
	cmd.Env = append(os.Environ(), "HOME="+t.TempDir())
	out, _ := cmd.CombinedOutput()
	assert.Contains(t, strings.ToLower(string(out)), "error", "expected error message for unreachable URL")
}

func TestIntegration_HiddenAliases(t *testing.T) {
	cmd := exec.Command(cliBinary, "--help")
	out, err := cmd.CombinedOutput()
	require.NoError(t, err)
	help := string(out)
	assert.NotContains(t, help, "lua-script", "lua-script should be hidden")

	lines := strings.Split(help, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "lua ") && !strings.Contains(trimmed, "eval") {
			t.Errorf("'lua' should be hidden from help, found: %s", line)
		}
	}
}

func TestIntegration_ResponseTime(t *testing.T) {
	start := time.Now()
	runCLI(t, "--json", "eval", "1")
	elapsed := time.Since(start)

	assert.Less(t, elapsed, 5*time.Second, "eval should complete quickly")
}
