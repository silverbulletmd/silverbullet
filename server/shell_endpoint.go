package server

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
)

var shellCommandsTotal = prometheus.NewCounter(prometheus.CounterOpts{
	Name: "silverbullet_shell_executions",
	Help: "Total number of shell commands executions",
})

func init() {
	prometheus.MustRegister(shellCommandsTotal)
}

// handleShellEndpoint handles POST requests to /.shell for executing shell commands
func handleShellEndpoint(w http.ResponseWriter, r *http.Request) {
	spaceConfig, ok := spaceConfigFromContext(r.Context())
	if !ok {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	// Parse the request body
	var shellRequest ShellRequest
	if err := json.NewDecoder(r.Body).Decode(&shellRequest); err != nil {
		http.Error(w, "Invalid JSON request", http.StatusBadRequest)
		return
	}

	// Execute the shell command
	shellResponse, err := spaceConfig.ShellBackend.Handle(shellRequest)
	if err != nil {
		log.Printf("Shell error: %v\n", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	shellCommandsTotal.Inc()

	// Return the response as JSON
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(shellResponse); err != nil {
		log.Printf("Error encoding shell response: %v\n", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}
