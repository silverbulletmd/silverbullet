//go:build integration

package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/silverbulletmd/silverbullet/client_bundle"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSpacePath = "testdata/test_space"

// testServer wraps an httptest.Server with the server config for integration tests.
type testServer struct {
	Server      *httptest.Server
	Config      *ServerConfig
	SpaceConfig *SpaceConfig
}

type testServerOption func(*ServerConfig, *SpaceConfig)

func withAuth(user, pass, token string) testServerOption {
	return func(sc *ServerConfig, sp *SpaceConfig) {
		sp.Auth = &AuthOptions{
			User:            user,
			Pass:            pass,
			AuthToken:       token,
			LockoutLimit:    10,
			LockoutTime:     60,
			RememberMeHours: 168,
		}
		sp.Authorize = func(u, p string) bool {
			return u == user && p == pass
		}
	}
}

func withHeadlessToken(token string) testServerOption {
	return func(sc *ServerConfig, _ *SpaceConfig) {
		sc.HeadlessToken = token
	}
}

func withRuntimeAPI() testServerOption {
	return func(_ *ServerConfig, sp *SpaceConfig) {
		sp.EnableRuntimeAPI = true
	}
}

// newTestServer creates a server with the real client bundle and base_fs,
// backed by a writable temp dir copy of testdata/test_space.
func newTestServer(t *testing.T, opts ...testServerOption) *testServer {
	t.Helper()

	tmpDir := t.TempDir()

	// Copy test space files to temp dir
	absPath, err := filepath.Abs(testSpacePath)
	require.NoError(t, err)

	srcPrimitives, err := NewDiskSpacePrimitives(absPath, "")
	require.NoError(t, err)

	dstPrimitives, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	files, err := srcPrimitives.FetchFileList()
	require.NoError(t, err)
	for _, f := range files {
		data, _, err := srcPrimitives.ReadFile(f.Name)
		require.NoError(t, err)
		_, err = dstPrimitives.WriteFile(f.Name, data, nil)
		require.NoError(t, err)
	}

	bundleTime := time.Now()
	bundledFiles := client_bundle.BundledFiles

	// Wrap disk primitives with base_fs fallthrough so Library/Std files are available
	spacePrimitives := NewReadOnlyFallthroughSpacePrimitives(
		bundledFiles, "base_fs", bundleTime, dstPrimitives,
	)

	spaceConfig := &SpaceConfig{
		IndexPage:       "index",
		SpaceName:       "TestSpace",
		SpaceFolderPath: tmpDir,
		SpacePrimitives: spacePrimitives,
		ShellBackend:    NewNotSupportedShell(),
	}

	serverConfig := &ServerConfig{
		Port:     0,
		BindHost: "127.0.0.1",
		SpaceConfigResolver: func(r *http.Request) (*SpaceConfig, error) {
			return spaceConfig, nil
		},
		ClientBundle: NewReadOnlyFallthroughSpacePrimitives(
			bundledFiles, "client", bundleTime, nil,
		),
		RuntimeBridge: NewRuntimeBridge(nil),
	}

	for _, opt := range opts {
		opt(serverConfig, spaceConfig)
	}

	r := Router(serverConfig)
	ts := httptest.NewServer(r)

	return &testServer{
		Server:      ts,
		Config:      serverConfig,
		SpaceConfig: spaceConfig,
	}
}

// startHeadless creates a server with the real client, launches Chrome,
// and registers cleanup for both.
func startHeadless(t *testing.T, opts ...testServerOption) *testServer {
	t.Helper()

	opts = append([]testServerOption{withRuntimeAPI()}, opts...)
	ts := newTestServer(t, opts...)
	t.Cleanup(ts.Server.Close)

	hb, err := StartHeadlessBrowser(&HeadlessConfig{
		ServerURL:     ts.Server.URL,
		HeadlessToken: ts.Config.HeadlessToken,
	})
	require.NoError(t, err, "headless browser should start")
	t.Cleanup(hb.Stop)

	readyCtx, readyCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer readyCancel()
	require.NoError(t, hb.WaitReady(readyCtx), "headless browser client should become ready")

	ts.Config.RuntimeBridge.SetBrowser(hb)

	return ts
}

const testAuthUser = "admin"
const testAuthPass = "secret"
const testAuthToken = "test-api-token"
const testHeadlessToken = "test-headless-token"

// authedRequest makes a request with Bearer token authentication.
// For POST and PUT requests, Content-Type is set to "text/plain".
func authedRequest(method, url, token string, body string) (*http.Response, error) {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}
	if method == http.MethodPost || method == http.MethodPut {
		req.Header.Set("Content-Type", "text/plain")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return http.DefaultClient.Do(req)
}

// loginAndGetCookie logs in via username/password and returns the auth cookie.
func loginAndGetCookie(t *testing.T, serverURL, user, pass string) *http.Cookie {
	t.Helper()

	form := url.Values{
		"username": {user},
		"password": {pass},
	}
	resp, err := http.PostForm(serverURL+"/.auth", form)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	for _, c := range resp.Cookies() {
		if strings.HasPrefix(c.Name, "auth_") {
			return c
		}
	}
	t.Fatal("no auth cookie returned from login")
	return nil
}

// cookiePost makes a POST request with a cookie for authentication.
func cookiePost(url, contentType string, cookie *http.Cookie, body string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.AddCookie(cookie)
	return http.DefaultClient.Do(req)
}

// --- No-auth headless tests (single Chrome instance) ---

func TestIntegration_Headless(t *testing.T) {
	ts := startHeadless(t)

	t.Run("Ping", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.ping")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, "OK", string(body))
		assert.Equal(t, ts.SpaceConfig.SpaceFolderPath, resp.Header.Get("X-Space-Path"))
	})

	t.Run("Config", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.config")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var config BootConfig
		err = json.NewDecoder(resp.Body).Decode(&config)
		require.NoError(t, err)
		assert.Equal(t, "index", config.IndexPage)
		assert.False(t, config.ReadOnly)
	})

	t.Run("FileList", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, ts.Server.URL+"/.fs/", nil)
		req.Header.Set("X-Sync-Mode", "true")

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var files []FileMeta
		err = json.NewDecoder(resp.Body).Decode(&files)
		require.NoError(t, err)

		names := make(map[string]bool)
		for _, f := range files {
			names[f.Name] = true
		}

		assert.True(t, names["index.md"], "should list index.md")
		assert.True(t, names["CONFIG.md"], "should list CONFIG.md")
		assert.True(t, names["Notes/Meeting Notes.md"], "should list Meeting Notes.md")
		assert.True(t, names["Projects/Project Alpha.md"], "should list Project Alpha.md")
	})

	t.Run("FileRead", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.fs/index.md")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Contains(t, string(body), "Welcome to the test space")
	})

	t.Run("FileReadSubdir", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.fs/Projects/Project%20Alpha.md")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Contains(t, string(body), "Project Alpha")
		assert.Contains(t, string(body), "#project")
	})

	t.Run("FileNotFound", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.fs/nonexistent.md")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	})

	t.Run("FileWrite", func(t *testing.T) {
		content := "# New Page\n\nCreated by test.\n"
		req, _ := http.NewRequest(http.MethodPut, ts.Server.URL+"/.fs/new_page.md", strings.NewReader(content))
		req.Header.Set("Content-Type", "text/markdown")

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		resp, err = http.Get(ts.Server.URL + "/.fs/new_page.md")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, content, string(body))
	})

	t.Run("FileWriteInSubdir", func(t *testing.T) {
		content := "# Deep Note\n"
		req, _ := http.NewRequest(http.MethodPut, ts.Server.URL+"/.fs/Notes/deep/nested.md", strings.NewReader(content))
		req.Header.Set("Content-Type", "text/markdown")

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		resp, err = http.Get(ts.Server.URL + "/.fs/Notes/deep/nested.md")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, content, string(body))
	})

	t.Run("FileDelete", func(t *testing.T) {
		// Write a file to delete (don't delete index.md — other tests may need it)
		content := "# Delete Me\n"
		req, _ := http.NewRequest(http.MethodPut, ts.Server.URL+"/.fs/delete_me.md", strings.NewReader(content))
		req.Header.Set("Content-Type", "text/markdown")
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		resp.Body.Close()

		req, _ = http.NewRequest(http.MethodDelete, ts.Server.URL+"/.fs/delete_me.md", nil)
		resp, err = http.DefaultClient.Do(req)
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		resp, err = http.Get(ts.Server.URL + "/.fs/delete_me.md")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	})

	t.Run("LuaEval", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader("1 + 1"))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, float64(2), result["result"])
	})

	t.Run("LuaScript", func(t *testing.T) {
		script := `local x = 10
local y = 20
return x + y`

		resp, err := http.Post(ts.Server.URL+"/.runtime/lua_script", "text/plain", strings.NewReader(script))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, float64(30), result["result"])
	})

	t.Run("LuaStringResult", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader(`"hello " .. "world"`))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, "hello world", result["result"])
	})

	t.Run("LuaError", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader("nonexistent_var.field"))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)

		var errResult map[string]any
		err = json.NewDecoder(resp.Body).Decode(&errResult)
		require.NoError(t, err)
		assert.NotEmpty(t, errResult["error"])
	})

	t.Run("FileListViaLua", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader(`space.listFiles()`))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)

		assert.Contains(t, bodyStr, "index.md")
		assert.Contains(t, bodyStr, "CONFIG.md")
	})

	t.Run("SpaceLuaFunction", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain",
			strings.NewReader(`greetMe("world")`))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, "Hello, world!", result["result"])
	})

	t.Run("ReadPageViaLua", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader(`space.readPage("index")`))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		body, _ := io.ReadAll(resp.Body)
		assert.Contains(t, string(body), "Welcome to the test space")
	})

	t.Run("MultipleRequests", func(t *testing.T) {
		expressions := []struct {
			expr     string
			expected float64
		}{
			{"1 + 1", 2},
			{"10 * 5", 50},
			{"100 - 1", 99},
			{"2 ^ 10", 1024},
		}

		for _, tc := range expressions {
			t.Run(tc.expr, func(t *testing.T) {
				resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader(tc.expr))
				require.NoError(t, err)
				defer resp.Body.Close()

				assert.Equal(t, http.StatusOK, resp.StatusCode)

				var result map[string]any
				err = json.NewDecoder(resp.Body).Decode(&result)
				require.NoError(t, err)
				assert.Equal(t, tc.expected, result["result"],
					fmt.Sprintf("expected %s = %v", tc.expr, tc.expected))
			})
		}
	})

	t.Run("Screenshot", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.runtime/screenshot")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.Equal(t, "image/png", resp.Header.Get("Content-Type"))

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.True(t, len(body) > 100, "screenshot should be non-trivial size")
		assert.Equal(t, byte(0x89), body[0])
		assert.Equal(t, byte('P'), body[1])
		assert.Equal(t, byte('N'), body[2])
		assert.Equal(t, byte('G'), body[3])
	})

	t.Run("Logs", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.runtime/logs")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		logs, ok := result["logs"].([]any)
		require.True(t, ok, "response should contain logs array")
		require.NotEmpty(t, logs, "logs should not be empty after client boot")

		first, ok := logs[0].(map[string]any)
		require.True(t, ok)
		assert.NotEmpty(t, first["level"])
		assert.NotEmpty(t, first["text"])
		assert.NotZero(t, first["timestamp"])
	})

	t.Run("LogsLimit", func(t *testing.T) {
		resp, err := http.Get(ts.Server.URL + "/.runtime/logs?limit=5")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		logs, ok := result["logs"].([]any)
		require.True(t, ok)
		assert.LessOrEqual(t, len(logs), 5)
	})

}

// --- Auth-enabled headless tests (single Chrome instance) ---

func TestIntegration_HeadlessAuth(t *testing.T) {
	ts := startHeadless(t,
		withAuth(testAuthUser, testAuthPass, testAuthToken),
		withHeadlessToken(testHeadlessToken),
	)

	noRedirectClient := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}

	// --- Bearer token auth for file operations ---

	t.Run("BearerToken", func(t *testing.T) {
		// Without auth: should get 401
		resp, err := noRedirectClient.Get(ts.Server.URL + "/.fs/index.md")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
		assert.Contains(t, resp.Header.Get("Location"), "/.auth")

		// With Bearer token: should succeed
		resp, err = authedRequest(http.MethodGet, ts.Server.URL+"/.fs/index.md", testAuthToken, "")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Contains(t, string(body), "Welcome to the test space")
	})

	t.Run("InvalidBearerToken", func(t *testing.T) {
		resp, err := authedRequest(http.MethodGet, ts.Server.URL+"/.fs/index.md", "wrong-token", "")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("HeadlessToken", func(t *testing.T) {
		resp, err := noRedirectClient.Get(ts.Server.URL + "/.config?token=" + testHeadlessToken)
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var authCookie *http.Cookie
		for _, c := range resp.Cookies() {
			if strings.HasPrefix(c.Name, "auth_") {
				authCookie = c
				break
			}
		}
		require.NotNil(t, authCookie, "should have received an auth cookie")

		// Subsequent request with cookie should work
		req, _ := http.NewRequest(http.MethodGet, ts.Server.URL+"/.fs/index.md", nil)
		req.AddCookie(authCookie)
		resp, err = http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Contains(t, string(body), "Welcome to the test space")
	})

	t.Run("InvalidHeadlessToken", func(t *testing.T) {
		resp, err := noRedirectClient.Get(ts.Server.URL + "/.config?token=wrong-token")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("FileWriteReadDelete", func(t *testing.T) {
		content := "# Authenticated Write\n"
		req, _ := http.NewRequest(http.MethodPut, ts.Server.URL+"/.fs/auth_test.md", strings.NewReader(content))
		req.Header.Set("Authorization", "Bearer "+testAuthToken)
		req.Header.Set("Content-Type", "text/markdown")
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		resp, err = authedRequest(http.MethodGet, ts.Server.URL+"/.fs/auth_test.md", testAuthToken, "")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, content, string(body))

		resp, err = authedRequest(http.MethodDelete, ts.Server.URL+"/.fs/auth_test.md", testAuthToken, "")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)

		resp, err = authedRequest(http.MethodGet, ts.Server.URL+"/.fs/auth_test.md", testAuthToken, "")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	})

	// --- Runtime API with auth ---

	t.Run("LuaEval", func(t *testing.T) {
		resp, err := authedRequest(http.MethodPost, ts.Server.URL+"/.runtime/lua", testAuthToken, "1 + 1")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, float64(2), result["result"])
	})

	t.Run("LuaScript", func(t *testing.T) {
		script := `local x = 10
local y = 20
return x + y`

		resp, err := authedRequest(http.MethodPost, ts.Server.URL+"/.runtime/lua_script", testAuthToken, script)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, float64(30), result["result"])
	})

	t.Run("LuaError", func(t *testing.T) {
		resp, err := authedRequest(http.MethodPost, ts.Server.URL+"/.runtime/lua", testAuthToken, "nonexistent_var.field")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)

		var errResult map[string]any
		err = json.NewDecoder(resp.Body).Decode(&errResult)
		require.NoError(t, err)
		assert.NotEmpty(t, errResult["error"])
	})

	t.Run("FileListViaLua", func(t *testing.T) {
		resp, err := authedRequest(http.MethodPost, ts.Server.URL+"/.runtime/lua", testAuthToken, `space.listFiles()`)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)

		assert.Contains(t, bodyStr, "index.md")
		assert.Contains(t, bodyStr, "CONFIG.md")
	})

	t.Run("Unauthorized", func(t *testing.T) {
		resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader("1 + 1"))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("InvalidToken", func(t *testing.T) {
		resp, err := authedRequest(http.MethodPost, ts.Server.URL+"/.runtime/lua", "wrong-token", "1 + 1")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("MultipleRequests", func(t *testing.T) {
		expressions := []struct {
			expr     string
			expected float64
		}{
			{"1 + 1", 2},
			{"10 * 5", 50},
			{"100 - 1", 99},
			{"2 ^ 10", 1024},
		}

		for _, tc := range expressions {
			t.Run(tc.expr, func(t *testing.T) {
				resp, err := authedRequest(http.MethodPost, ts.Server.URL+"/.runtime/lua", testAuthToken, tc.expr)
				require.NoError(t, err)
				defer resp.Body.Close()

				assert.Equal(t, http.StatusOK, resp.StatusCode)

				var result map[string]any
				err = json.NewDecoder(resp.Body).Decode(&result)
				require.NoError(t, err)
				assert.Equal(t, tc.expected, result["result"],
					fmt.Sprintf("expected %s = %v", tc.expr, tc.expected))
			})
		}
	})

	// --- Cookie-based auth ---

	cookie := loginAndGetCookie(t, ts.Server.URL, testAuthUser, testAuthPass)

	t.Run("CookieAuth_LuaEval", func(t *testing.T) {
		resp, err := cookiePost(ts.Server.URL+"/.runtime/lua", "text/plain", cookie, "1 + 1")
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, float64(2), result["result"])
	})

	t.Run("CookieAuth_LuaScript", func(t *testing.T) {
		script := `local x = 10
local y = 20
return x + y`

		resp, err := cookiePost(ts.Server.URL+"/.runtime/lua_script", "text/plain", cookie, script)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, float64(30), result["result"])
	})

	t.Run("CookieAuth_InvalidCredentials", func(t *testing.T) {
		form := url.Values{
			"username": {"admin"},
			"password": {"wrong"},
		}
		resp, err := http.PostForm(ts.Server.URL+"/.auth", form)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var result map[string]any
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)
		assert.Equal(t, "error", result["status"])

		for _, c := range resp.Cookies() {
			assert.False(t, strings.HasPrefix(c.Name, "auth_"), "should not receive auth cookie on failed login")
		}
	})
}

// --- Runtime disabled tests (no Chrome needed) ---

func TestIntegration_RuntimeDisabled(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Server.Close()

	resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader("1+1"))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
	body, _ := io.ReadAll(resp.Body)
	assert.Contains(t, string(body), "Runtime API is not enabled")

	resp2, err := http.Get(ts.Server.URL + "/.runtime/screenshot")
	require.NoError(t, err)
	defer resp2.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, resp2.StatusCode)

	resp3, err := http.Get(ts.Server.URL + "/.runtime/logs")
	require.NoError(t, err)
	defer resp3.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, resp3.StatusCode)
}

func TestIntegration_RuntimeNoClients(t *testing.T) {
	ts := newTestServer(t, withRuntimeAPI())
	defer ts.Server.Close()

	resp, err := http.Post(ts.Server.URL+"/.runtime/lua", "text/plain", strings.NewReader("1+1"))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
}
