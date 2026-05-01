package server

import (
	"bufio"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// NodeBridgeConfig holds configuration for the Node.js agent bridge sidecar.
type NodeBridgeConfig struct {
	NodePath   string // path to node binary
	ScriptPath string // path to agent-bridge/index.mjs
}

// NodeBridge manages a Node.js sidecar process that runs the Claude Agent SDK bridge.
type NodeBridge struct {
	config   *NodeBridgeConfig
	cmd      *exec.Cmd
	port     int
	proxy    *httputil.ReverseProxy
	done     chan struct{}
	readyCh  chan struct{}
	readyErr error
	mu       sync.Mutex
}

// StartNodeBridge launches the Node.js agent bridge process.
func StartNodeBridge(config *NodeBridgeConfig) (*NodeBridge, error) {
	nb := &NodeBridge{
		config: config,
		done:   make(chan struct{}),
	}

	if err := nb.launch(); err != nil {
		return nil, err
	}

	// Start auto-restart monitor
	go nb.monitor()

	return nb, nil
}

func (nb *NodeBridge) launch() error {
	// Verify node binary exists
	if _, err := exec.LookPath(nb.config.NodePath); err != nil {
		return fmt.Errorf("node binary not found at %q: %w", nb.config.NodePath, err)
	}

	// Verify script exists
	if _, err := os.Stat(nb.config.ScriptPath); err != nil {
		return fmt.Errorf("agent bridge script not found at %q: %w", nb.config.ScriptPath, err)
	}

	cmd := exec.Command(nb.config.NodePath, nb.config.ScriptPath)
	cmd.Env = append(os.Environ(), "PORT=0")
	cmd.Stderr = os.Stderr // Forward Node stderr to server stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start node bridge: %w", err)
	}

	nb.mu.Lock()
	nb.cmd = cmd
	nb.mu.Unlock()

	// Read READY:<port> from stdout
	readyCh := make(chan struct{})
	nb.readyCh = readyCh
	nb.readyErr = nil

	go func() {
		defer close(readyCh)
		scanner := bufio.NewScanner(stdout)
		timeout := time.NewTimer(30 * time.Second)
		defer timeout.Stop()

		readyReceived := make(chan string, 1)
		go func() {
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "READY:") {
					readyReceived <- line
					return
				}
			}
		}()

		select {
		case line := <-readyReceived:
			portStr := strings.TrimPrefix(line, "READY:")
			port, err := strconv.Atoi(portStr)
			if err != nil {
				nb.readyErr = fmt.Errorf("invalid port in READY line: %q", line)
				return
			}
			nb.mu.Lock()
			nb.port = port
			proxyURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
			nb.proxy = httputil.NewSingleHostReverseProxy(proxyURL)
			nb.mu.Unlock()
			log.Printf("[AgentBridge] Node sidecar ready on port %d", port)
		case <-timeout.C:
			nb.readyErr = fmt.Errorf("timeout waiting for node bridge to become ready")
			cmd.Process.Kill()
		}
	}()

	return nil
}

// WaitReady blocks until the node bridge is ready or fails.
func (nb *NodeBridge) WaitReady() error {
	if nb.readyCh == nil {
		return fmt.Errorf("node bridge not started")
	}
	<-nb.readyCh
	return nb.readyErr
}

// Stop shuts down the Node.js bridge process.
func (nb *NodeBridge) Stop() {
	close(nb.done)

	nb.mu.Lock()
	cmd := nb.cmd
	nb.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return
	}

	// Send SIGTERM for graceful shutdown
	cmd.Process.Signal(syscall.SIGTERM)

	// Wait up to 5 seconds for exit
	exitCh := make(chan struct{})
	go func() {
		cmd.Wait()
		close(exitCh)
	}()

	select {
	case <-exitCh:
		log.Println("[AgentBridge] Node bridge stopped gracefully")
	case <-time.After(5 * time.Second):
		cmd.Process.Kill()
		log.Println("[AgentBridge] Node bridge force-killed after timeout")
	}
}

// monitor watches for process exit and restarts with exponential backoff.
func (nb *NodeBridge) monitor() {
	backoff := 2 * time.Second
	maxBackoff := 2 * time.Minute

	for {
		// Wait for process to exit
		nb.mu.Lock()
		cmd := nb.cmd
		nb.mu.Unlock()

		if cmd != nil {
			cmd.Wait()
		}

		// Check if we're shutting down
		select {
		case <-nb.done:
			return
		default:
		}

		log.Printf("[AgentBridge] Node bridge exited unexpectedly, restarting in %v...", backoff)

		select {
		case <-nb.done:
			return
		case <-time.After(backoff):
		}

		if err := nb.launch(); err != nil {
			log.Printf("[AgentBridge] Restart failed: %v", err)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		if err := nb.WaitReady(); err != nil {
			log.Printf("[AgentBridge] Restart readiness failed: %v", err)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		log.Println("[AgentBridge] Restart successful")
		backoff = 2 * time.Second
	}
}

// ProxyHandler returns an HTTP handler that reverse-proxies to the Node sidecar.
func (nb *NodeBridge) ProxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nb.mu.Lock()
		proxy := nb.proxy
		nb.mu.Unlock()

		if proxy == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error": map[string]string{
					"type":    "server_error",
					"message": "Agent bridge is not ready",
				},
			})
			return
		}

		proxy.ServeHTTP(w, r)
	})
}
