package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

// HeadlessConfig holds configuration for the headless browser
type HeadlessConfig struct {
	ServerURL     string // e.g. "http://127.0.0.1:3000/prefix"
	HeadlessToken string // random token for URL-based auth (empty = no auth)
	ChromePath    string // from SB_CHROME_PATH / CHROMIUM_PATH
	ShowBrowser   bool   // if true, run Chrome with a visible window (SB_CHROME_SHOW=1)
	UserDataDir   string // if set, persist Chrome profile to this path (SB_CHROME_DATA_DIR)
}

// ConsoleLogEntry represents a single console log entry captured from the headless browser.
type ConsoleLogEntry struct {
	Level     string `json:"level"` // "log", "warn", "error", "info", "debug"
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"` // unix millis
}

// HeadlessBrowser manages a headless Chrome instance that acts as a SilverBullet client
type HeadlessBrowser struct {
	config      *HeadlessConfig
	cancel      context.CancelFunc
	allocCancel context.CancelFunc
	ctx         context.Context
	done        chan struct{}

	logsMu  sync.Mutex
	logs    []ConsoleLogEntry
	maxLogs int // ring buffer capacity

	readyCh  chan struct{} // closed when client eval functions are ready
	readyErr error         // non-nil if client failed to become ready
}

// StartHeadlessBrowser launches a headless Chrome browser and navigates to the SilverBullet URL.
// It returns as soon as the browser is navigating and collecting logs. The client may not be
// fully ready yet; call WaitReady to block until eval functions are available.
func StartHeadlessBrowser(config *HeadlessConfig) (*HeadlessBrowser, error) {
	hb := &HeadlessBrowser{
		config:  config,
		done:    make(chan struct{}),
		maxLogs: 1000,
	}

	if err := hb.launch(); err != nil {
		return nil, err
	}

	// Start auto-restart monitor
	go hb.monitor()

	return hb, nil
}

// WaitReady blocks until the client's eval functions are ready, or ctx is cancelled.
func (hb *HeadlessBrowser) WaitReady(ctx context.Context) error {
	select {
	case <-hb.readyCh:
		return hb.readyErr
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (hb *HeadlessBrowser) launch() error {
	// Various options to reduce memory consumption, primarily
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("in-process-gpu", true),
		chromedp.WindowSize(800, 600),
	)

	if hb.config.ShowBrowser {
		// Remove the headless flag so Chrome opens a visible window
		opts = append(opts, chromedp.Flag("headless", false))
		log.Println("[Headless] Running Chrome with visible window (SB_CHROME_SHOW=1)")
	}

	if hb.config.UserDataDir != "" {
		// Remove stale lock file left behind if the server was hard-killed.
		// Chrome refuses to start when a SingletonLock exists from a dead process.
		lockFile := filepath.Join(hb.config.UserDataDir, "SingletonLock")
		if err := os.Remove(lockFile); err == nil {
			log.Println("[Headless] Removed stale Chrome lock file")
		}
		opts = append(opts, chromedp.UserDataDir(hb.config.UserDataDir))
		log.Printf("[Headless] Using persistent Chrome profile: %s", hb.config.UserDataDir)
	}

	if hb.config.ChromePath != "" {
		opts = append(opts, chromedp.ExecPath(hb.config.ChromePath))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	hb.allocCancel = allocCancel

	ctx, cancel := chromedp.NewContext(allocCtx)
	hb.cancel = cancel
	hb.ctx = ctx

	// Navigate to the SilverBullet client in headless mode
	url := strings.TrimRight(hb.config.ServerURL, "/") + "/?headless=1"
	if hb.config.HeadlessToken != "" {
		url += "&token=" + hb.config.HeadlessToken
	}
	log.Printf("[Headless] Navigating to %s", url)

	// Listen for console API calls from the browser
	chromedp.ListenTarget(ctx, func(ev any) {
		if consoleEvent, ok := ev.(*runtime.EventConsoleAPICalled); ok {
			var parts []string
			for _, arg := range consoleEvent.Args {
				if arg.Value != nil {
					// Unquote JSON string values
					var s string
					if err := json.Unmarshal(arg.Value, &s); err == nil {
						parts = append(parts, s)
					} else {
						parts = append(parts, string(arg.Value))
					}
				} else if arg.Description != "" {
					parts = append(parts, arg.Description)
				}
			}
			entry := ConsoleLogEntry{
				Level:     consoleEvent.Type.String(),
				Text:      strings.Join(parts, " "),
				Timestamp: time.Now().UnixMilli(),
			}
			hb.appendLog(entry)
		}
	})

	if err := chromedp.Run(ctx,
		chromedp.Navigate(url),
	); err != nil {
		cancel()
		allocCancel()
		return fmt.Errorf("failed to navigate: %w", err)
	}

	// Wait for client readiness in the background so logs are available immediately
	readyCh := make(chan struct{})
	hb.readyCh = readyCh
	hb.readyErr = nil
	go func() {
		defer close(readyCh)
		readyCtx, readyCancel := context.WithTimeout(ctx, 60*time.Second)
		defer readyCancel()
		if err := waitForClientReady(readyCtx); err != nil {
			hb.readyErr = fmt.Errorf("client did not become ready: %w", err)
			log.Printf("[Headless] %v", hb.readyErr)
		} else {
			log.Println("[Headless] Browser client connected successfully")
		}
	}()

	return nil
}

// Stop shuts down the headless browser
func (hb *HeadlessBrowser) Stop() {
	close(hb.done)
	if hb.cancel != nil {
		hb.cancel()
	}
	if hb.allocCancel != nil {
		hb.allocCancel()
	}
	log.Println("[Headless] Browser stopped")
}

// monitor watches for Chrome crashes and restarts with exponential backoff
func (hb *HeadlessBrowser) monitor() {
	backoff := 2 * time.Second
	maxBackoff := 2 * time.Minute

	for {
		// Wait for Chrome to exit (context cancelled) or explicit stop
		select {
		case <-hb.done:
			return
		case <-hb.ctx.Done():
			// Chrome exited unexpectedly
		}

		select {
		case <-hb.done:
			return
		default:
		}

		log.Printf("[Headless] Browser exited unexpectedly, restarting in %v...", backoff)

		// Clean up old context
		if hb.cancel != nil {
			hb.cancel()
		}
		if hb.allocCancel != nil {
			hb.allocCancel()
		}

		// Wait before restarting
		select {
		case <-hb.done:
			return
		case <-time.After(backoff):
		}

		if err := hb.launch(); err != nil {
			log.Printf("[Headless] Restart failed: %v", err)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		// Wait for client to become fully ready before declaring success
		if err := hb.WaitReady(hb.ctx); err != nil {
			log.Printf("[Headless] Restart client readiness failed: %v", err)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		log.Println("[Headless] Restart successful")
		backoff = 2 * time.Second
	}
}

// appendLog adds a console log entry to the ring buffer.
func (hb *HeadlessBrowser) appendLog(entry ConsoleLogEntry) {
	hb.logsMu.Lock()
	defer hb.logsMu.Unlock()
	if len(hb.logs) >= hb.maxLogs {
		// Drop oldest entry
		hb.logs = hb.logs[1:]
	}
	hb.logs = append(hb.logs, entry)
}

// Screenshot captures the current viewport as a PNG image.
func (hb *HeadlessBrowser) Screenshot() ([]byte, error) {
	var buf []byte
	if err := chromedp.Run(hb.ctx, chromedp.CaptureScreenshot(&buf)); err != nil {
		return nil, fmt.Errorf("screenshot failed: %w", err)
	}
	return buf, nil
}

// Logs returns the last N console log entries.
func (hb *HeadlessBrowser) Logs(limit int, since int64) []ConsoleLogEntry {
	hb.logsMu.Lock()
	defer hb.logsMu.Unlock()

	// If since is set, filter to entries after that timestamp
	if since > 0 {
		if len(hb.logs) == 0 || hb.logs[len(hb.logs)-1].Timestamp <= since {
			return []ConsoleLogEntry{}
		}
		start := len(hb.logs)
		for i := len(hb.logs) - 1; i >= 0; i-- {
			if hb.logs[i].Timestamp <= since {
				break
			}
			start = i
		}
		result := make([]ConsoleLogEntry, len(hb.logs)-start)
		copy(result, hb.logs[start:])
		return result
	}

	if limit <= 0 || limit > len(hb.logs) {
		limit = len(hb.logs)
	}
	// Return the most recent entries
	start := len(hb.logs) - limit
	result := make([]ConsoleLogEntry, limit)
	copy(result, hb.logs[start:])
	return result
}

// evalViaGlobal calls a global async JS function (e.g. __sbEvalLua) with the given code
// string via CDP runtime.Evaluate, awaiting the promise and returning the result.
func (hb *HeadlessBrowser) evalViaGlobal(ctx context.Context, fnName string, code string) (any, error) {
	// JSON-encode the code string to safely embed it in JS
	codeJSON, err := json.Marshal(code)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal code: %w", err)
	}

	js := fmt.Sprintf(`globalThis.%s(%s)`, fnName, string(codeJSON))

	// Use chromedp to evaluate with await
	var result any
	if err := chromedp.Run(ctx,
		chromedp.Evaluate(js, &result, func(p *runtime.EvaluateParams) *runtime.EvaluateParams {
			return p.WithAwaitPromise(true).WithReturnByValue(true)
		}),
	); err != nil {
		return nil, fmt.Errorf("CDP eval failed: %w", err)
	}

	return result, nil
}

// EvalLua evaluates a Lua expression via the browser's global __sbEvalLua function.
func (hb *HeadlessBrowser) EvalLua(ctx context.Context, expr string) (any, error) {
	return hb.evalViaGlobal(ctx, "__sbEvalLua", expr)
}

// EvalLuaScript evaluates a Lua script via the browser's global __sbEvalLuaScript function.
func (hb *HeadlessBrowser) EvalLuaScript(ctx context.Context, script string) (any, error) {
	return hb.evalViaGlobal(ctx, "__sbEvalLuaScript", script)
}

// waitForClientReady polls until the SilverBullet client's eval functions are ready
func waitForClientReady(ctx context.Context) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	clientDetected := false
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for client to be ready")
		case <-ticker.C:
			// First check if the client object exists (basic boot check)
			if !clientDetected {
				var hasClient bool
				err := chromedp.Run(ctx,
					chromedp.Evaluate(`!!globalThis.client`, &hasClient),
				)
				if err != nil {
					continue // Page may not be fully loaded yet
				}
				if hasClient {
					log.Println("[Headless] Client object detected, waiting for eval functions and index...")
					clientDetected = true
				}
				continue
			}

			// Check the global readiness flag (set after WS connected + index complete)
			var ready bool
			err := chromedp.Run(ctx,
				chromedp.Evaluate(`!!globalThis.__sbRuntimeAPIReady`, &ready),
			)
			if err != nil {
				continue
			}
			if ready {
				return nil
			}
		}
	}
}
