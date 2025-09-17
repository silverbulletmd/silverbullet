package server

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// handleShellEndpoint handles POST requests to /.shell for executing shell commands
func handleShellEndpoint(config *ServerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Parse the request body
		var shellRequest ShellRequest
		if err := json.NewDecoder(r.Body).Decode(&shellRequest); err != nil {
			http.Error(w, "Invalid JSON request", http.StatusBadRequest)
			return
		}

		// Execute the shell command
		shellResponse, err := config.ShellBackend.Handle(shellRequest)
		if err != nil {
			fmt.Printf("Shell error: %v\n", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Return the response as JSON
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(shellResponse); err != nil {
			fmt.Printf("Error encoding shell response: %v\n", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
	}
}
