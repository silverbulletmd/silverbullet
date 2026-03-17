package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var runtimeAPIRequestsTotal = prometheus.NewCounter(prometheus.CounterOpts{
	Name: "silverbullet_runtime_api_requests_total",
	Help: "Total number of runtime API requests received",
})

func init() {
	prometheus.MustRegister(runtimeAPIRequestsTotal)
}

// RuntimeBridge manages the headless browser for Runtime API requests.
type RuntimeBridge struct {
	mu       sync.Mutex
	config   *HeadlessConfig  // nil = headless disabled
	browser  *HeadlessBrowser // nil = not started yet
	starting chan struct{}    // non-nil while browser is starting; closed when done
	startErr error            // error from most recent start attempt
}

// NewRuntimeBridge creates a new RuntimeBridge. Pass nil config to disable headless.
func NewRuntimeBridge(config *HeadlessConfig) *RuntimeBridge {
	return &RuntimeBridge{
		config: config,
	}
}

// ensureLaunched starts the headless browser if not already launched.
// Returns as soon as the browser process is running and collecting logs,
// but the client may not be fully ready for eval yet.
func (b *RuntimeBridge) ensureLaunched(ctx context.Context) error {
	if b.config == nil {
		return nil // headless disabled, nothing to start
	}

	b.mu.Lock()

	// Already running?
	if b.browser != nil && b.browser.ctx.Err() == nil {
		b.mu.Unlock()
		return nil
	}

	// Another goroutine is already starting?
	if b.starting != nil {
		ch := b.starting
		b.mu.Unlock()
		select {
		case <-ch:
			return b.startErr
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	// We are the starter
	b.starting = make(chan struct{})
	b.mu.Unlock()

	hb, err := StartHeadlessBrowser(b.config)

	b.mu.Lock()
	b.startErr = err
	if err == nil {
		b.browser = hb
	}
	close(b.starting)
	b.starting = nil
	b.mu.Unlock()

	return err
}

// EnsureRunning starts the headless browser and waits for the client to be fully ready.
func (b *RuntimeBridge) EnsureRunning(ctx context.Context) error {
	if err := b.ensureLaunched(ctx); err != nil {
		return err
	}
	browser := b.getBrowser()
	if browser == nil {
		return nil
	}
	return browser.WaitReady(ctx)
}

// SetBrowser sets the headless browser instance on the bridge (used in tests).
func (b *RuntimeBridge) SetBrowser(hb *HeadlessBrowser) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.browser = hb
}

// Stop shuts down the headless browser if running.
func (b *RuntimeBridge) Stop() {
	b.mu.Lock()
	browser := b.browser
	b.browser = nil
	b.mu.Unlock()

	if browser != nil {
		browser.Stop()
	}
}

// parseTimeout reads the X-Timeout header (seconds) and returns a duration, defaulting to 30s.
func parseTimeout(r *http.Request) time.Duration {
	if v := r.Header.Get("X-Timeout"); v != "" {
		if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
			return time.Duration(secs) * time.Second
		}
	}
	return 30 * time.Second
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// getBrowser returns the current browser instance, or nil.
func (b *RuntimeBridge) getBrowser() *HeadlessBrowser {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.browser
}

// evalAndRespond evaluates Lua via CDP and writes the HTTP response.
func (b *RuntimeBridge) evalAndRespond(w http.ResponseWriter, r *http.Request, fnName string, code string) {
	runtimeAPIRequestsTotal.Inc()

	// Lazy-start headless browser if configured
	if b.config != nil {
		if err := b.EnsureRunning(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": fmt.Sprintf("Failed to start headless browser: %v", err)})
			return
		}
	}

	browser := b.getBrowser()
	if browser == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "No headless browser running"})
		return
	}

	timeout := parseTimeout(r)
	ctx, cancel := context.WithTimeout(browser.ctx, timeout)
	defer cancel()

	result, err := browser.evalViaGlobal(ctx, fnName, code)
	if err != nil {
		if ctx.Err() != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]any{"error": "Request timed out"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

// HandleScreenshot captures a screenshot from the headless browser and returns it as PNG.
func (b *RuntimeBridge) HandleScreenshot(w http.ResponseWriter, r *http.Request) {
	if err := b.EnsureRunning(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": fmt.Sprintf("Failed to start headless browser: %v", err)})
		return
	}
	browser := b.getBrowser()
	if browser == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "No headless browser running"})
		return
	}
	png, err := browser.Screenshot()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Write(png)
}

// HandleConsoleLogs returns recent console log entries from the headless browser.
// Unlike other runtime endpoints, this does not wait for the client to be fully ready,
// so it can return boot logs while the client is still loading.
func (b *RuntimeBridge) HandleConsoleLogs(w http.ResponseWriter, r *http.Request) {
	if err := b.ensureLaunched(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": fmt.Sprintf("Failed to start headless browser: %v", err)})
		return
	}
	browser := b.getBrowser()
	if browser == nil {
		writeJSON(w, http.StatusOK, map[string]any{"logs": []ConsoleLogEntry{}})
		return
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	var since int64
	if v := r.URL.Query().Get("since"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			since = n
		}
	}
	logs := browser.Logs(limit, since)
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

// HandleLuaAPI handles POST /.runtime/lua — evaluates a Lua expression.
// Request body: raw Lua expression as plain text.
func (b *RuntimeBridge) HandleLuaAPI(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Failed to read request body"})
		return
	}
	expr := strings.TrimSpace(string(body))
	if expr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Request body is required"})
		return
	}

	b.evalAndRespond(w, r, "__sbEvalLua", expr)
}

// HandleLuaScriptAPI handles POST /.runtime/lua_script — evaluates a Lua script block.
// Request body: raw Lua script as plain text.
func (b *RuntimeBridge) HandleLuaScriptAPI(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Failed to read request body"})
		return
	}
	script := strings.TrimSpace(string(body))
	if script == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Request body is required"})
		return
	}

	b.evalAndRespond(w, r, "__sbEvalLuaScript", script)
}
