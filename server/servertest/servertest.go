// Package servertest provides test helpers for spinning up SilverBullet
// test servers. It exports the same setup used by the server integration
// tests so that other packages (e.g. cli) can write integration tests
// against a real server.
package servertest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/silverbulletmd/silverbullet/client_bundle"
	"github.com/silverbulletmd/silverbullet/server"
	"github.com/stretchr/testify/require"
)

// TestServer wraps an httptest.Server with its configuration.
type TestServer struct {
	Server      *httptest.Server
	Config      *server.ServerConfig
	SpaceConfig *server.SpaceConfig
}

// Option configures a test server.
type Option func(*server.ServerConfig, *server.SpaceConfig)

// WithAuth enables username/password + token authentication.
func WithAuth(user, pass, token string) Option {
	return func(sc *server.ServerConfig, sp *server.SpaceConfig) {
		sp.Auth = &server.AuthOptions{
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

// WithHeadlessToken sets the headless browser authentication token.
func WithHeadlessToken(token string) Option {
	return func(sc *server.ServerConfig, _ *server.SpaceConfig) {
		sc.HeadlessToken = token
	}
}

// WithRuntimeAPI enables the Runtime API endpoints.
func WithRuntimeAPI() Option {
	return func(_ *server.ServerConfig, sp *server.SpaceConfig) {
		sp.EnableRuntimeAPI = true
	}
}

// findModuleRoot walks up from the current working directory looking for go.mod.
func findModuleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
		dir = parent
	}
}

// NewTestServer creates a server backed by a temp-dir copy of server/testdata/test_space.
// The caller is responsible for calling ts.Server.Close().
func NewTestServer(t *testing.T, opts ...Option) *TestServer {
	t.Helper()

	moduleRoot, err := findModuleRoot()
	require.NoError(t, err, "could not find module root (go.mod)")

	testSpacePath := filepath.Join(moduleRoot, "server", "testdata", "test_space")
	tmpDir := t.TempDir()

	srcPrimitives, err := server.NewDiskSpacePrimitives(testSpacePath, "")
	require.NoError(t, err)

	dstPrimitives, err := server.NewDiskSpacePrimitives(tmpDir, "")
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

	spacePrimitives := server.NewReadOnlyFallthroughSpacePrimitives(
		bundledFiles, "base_fs", bundleTime, dstPrimitives,
	)

	spaceConfig := &server.SpaceConfig{
		IndexPage:       "index",
		SpaceName:       "TestSpace",
		SpaceFolderPath: tmpDir,
		SpacePrimitives: spacePrimitives,
		ShellBackend:    server.NewNotSupportedShell(),
	}

	serverConfig := &server.ServerConfig{
		Port:     0,
		BindHost: "127.0.0.1",
		SpaceConfigResolver: func(r *http.Request) (*server.SpaceConfig, error) {
			return spaceConfig, nil
		},
		ClientBundle: server.NewReadOnlyFallthroughSpacePrimitives(
			bundledFiles, "client", bundleTime, nil,
		),
		RuntimeBridge: server.NewRuntimeBridge(nil),
	}

	for _, opt := range opts {
		opt(serverConfig, spaceConfig)
	}

	r := server.Router(serverConfig)
	ts := httptest.NewServer(r)

	return &TestServer{
		Server:      ts,
		Config:      serverConfig,
		SpaceConfig: spaceConfig,
	}
}

// StartHeadless creates a test server with the Runtime API enabled,
// launches a headless Chrome browser, waits for it to become ready,
// and registers cleanup for both. Requires Chrome to be installed.
func StartHeadless(t *testing.T, opts ...Option) *TestServer {
	t.Helper()

	opts = append([]Option{WithRuntimeAPI()}, opts...)
	ts := NewTestServer(t, opts...)
	t.Cleanup(ts.Server.Close)

	// Generate a headless token if not already set (needed when auth is enabled)
	if ts.Config.HeadlessToken == "" {
		b := make([]byte, 32)
		_, err := rand.Read(b)
		require.NoError(t, err, "failed to generate headless token")
		ts.Config.HeadlessToken = hex.EncodeToString(b)
	}

	hb, err := server.StartHeadlessBrowser(&server.HeadlessConfig{
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
