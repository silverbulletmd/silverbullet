package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
)

func TestLocalhostRegex(t *testing.T) {
	// Should match (use HTTP)
	shouldMatch := []string{
		"localhost:8080/api",
		"127.0.0.1:8080/api",
		"192.168.1.1:8080/api",
		"host.docker.internal:11434/api",
	}

	// Should NOT match (use HTTPS)
	shouldNotMatch := []string{
		"api.openai.com/v1",
		"example.com:8443/api",
		"",
	}

	for _, input := range shouldMatch {
		assert.True(t, localhostRegex.MatchString(input), "should match: %s", input)
	}

	for _, input := range shouldNotMatch {
		assert.False(t, localhostRegex.MatchString(input), "should not match: %s", input)
	}
}

// TestProxyHandlerTimeout verifies that proxy requests timeout after a reasonable duration
// This prevents indefinite hangs when proxying to slow/unresponsive endpoints
// Note: This test takes ~30 seconds to run as it actually tests the timeout behavior
func TestProxyHandlerTimeout(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping timeout test in short mode")
	}

	// Create a test server that hangs (sleeps longer than timeout)
	hangingServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(35 * time.Second) // Longer than 30s timeout
		w.WriteHeader(http.StatusOK)
	}))
	defer hangingServer.Close()

	// Extract just the host:port from the test server URL
	// URL format is "http://127.0.0.1:port", we need "127.0.0.1:port/test"
	serverURL := hangingServer.URL[7:] // Remove "http://"

	// Create a proper chi router with the proxy route
	router := chi.NewRouter()
	
	// Set up space config middleware
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), spaceConfigKey, &SpaceConfig{
				ReadOnlyMode: false,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	
	// Register the proxy handler with chi wildcard route
	router.HandleFunc("/.proxy/*", proxyHandler)

	// Create test server with the chi router
	testServer := httptest.NewServer(router)
	defer testServer.Close()

	// Make the request through the test server
	client := &http.Client{
		Timeout: 35 * time.Second, // Allow client enough time
	}

	start := time.Now()
	resp, err := client.Get(testServer.URL + "/.proxy/" + serverURL + "/test")
	duration := time.Since(start)

	// The proxy should timeout internally (30s) before client timeout (35s)
	if err == nil {
		defer func() {
			if err := resp.Body.Close(); err != nil {
				t.Logf("Failed to close response body: %v", err)
			}
		}()
	}

	// Verify it timed out in a reasonable time (~30s, not 35s+)
	assert.Less(t, duration, 33*time.Second, "Request should timeout before 33 seconds")
	assert.Greater(t, duration, 28*time.Second, "Request should take at least 28 seconds (near timeout)")

	// Verify we got an error response (not success)
	if resp != nil {
		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode, "Should return 500 on timeout")
	}
}
