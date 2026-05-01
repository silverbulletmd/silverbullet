package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// buildClaudeBridgeRoutes creates the Claude bridge router.
// All requests are reverse-proxied to the Node.js agent bridge sidecar.
func buildClaudeBridgeRoutes(bridge *NodeBridge) chi.Router {
	r := chi.NewRouter()

	// CORS preflight
	r.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key, Anthropic-Version")
		w.WriteHeader(http.StatusNoContent)
	})

	if bridge != nil {
		r.Handle("/v1/*", bridge.ProxyHandler())
	} else {
		r.HandleFunc("/v1/*", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error": map[string]string{
					"type":    "server_error",
					"message": "Claude agent bridge is not available. Ensure Node.js is installed and the agent-bridge script is present.",
				},
			})
		})
	}

	return r
}
