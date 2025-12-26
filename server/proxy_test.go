package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

	// Create a test request to the proxy
	req := httptest.NewRequest("GET", "/.fs/"+hangingServer.URL[7:]+"/test", nil) // Remove "http://"
	ctx := context.WithValue(req.Context(), "spaceConfig", &SpaceConfig{
		ReadOnlyMode: false,
	})
	req = req.WithContext(ctx)

	// Record the response
	w := httptest.NewRecorder()

	// The proxy handler should timeout and return an error
	start := time.Now()
	proxyHandler(w, req)
	duration := time.Since(start)

	// Verify it timed out in a reasonable time (~30s, not 35s+)
	assert.Less(t, duration, 33*time.Second, "Request should timeout before 33 seconds")
	assert.Greater(t, duration, 28*time.Second, "Request should take at least 28 seconds (near timeout)")

	// Verify we got an error response (not success)
	assert.Equal(t, http.StatusInternalServerError, w.Code, "Should return 500 on timeout")
	assert.Contains(t, w.Body.String(), "timeout", "Error message should mention timeout")
}
