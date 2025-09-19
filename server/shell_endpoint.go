package server

import (
	"encoding/json"
	"log"
	"net/http"
)

// handleShellEndpoint handles POST requests to /.shell for executing shell commands
func handleShellEndpoint(config *ServerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
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

		// Return the response as JSON
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(shellResponse); err != nil {
			log.Printf("Error encoding shell response: %v\n", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
	}
}
