package server

import (
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

var localhostRegex *regexp.Regexp

func init() {
	localhostRegex = regexp.MustCompile(`^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)`)
}

func proxyHandler(config *ServerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		if spaceConfig.ReadOnlyMode {
			http.Error(w, "Read only mode, no proxy allowed", http.StatusMethodNotAllowed)
			return
		}

		// Extract the URI from the path
		path := chi.URLParam(r, "*")
		if path == "" {
			http.Error(w, "No URI provided", http.StatusBadRequest)
			return
		}

		// Add query parameters if they exist
		if r.URL.RawQuery != "" {
			path += "?" + r.URL.RawQuery
		}

		// Determine protocol based on hostname
		var targetURL string
		if localhostRegex.MatchString(path) {
			targetURL = "http://" + path
		} else {
			targetURL = "https://" + path
		}

		log.Printf("Proxying to %s\n", targetURL)

		// Create the proxy request
		req, err := http.NewRequest(r.Method, targetURL, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Copy safe headers
		safeHeaders := []string{"Authorization", "Accept", "Content-Type"}
		for _, header := range safeHeaders {
			if value := r.Header.Get(header); value != "" {
				req.Header.Set(header, value)
			}
		}

		// Copy headers starting with X-Proxy-Header-, removing the prefix
		for key, values := range r.Header {
			if strings.HasPrefix(strings.ToLower(key), "x-proxy-header-") {
				headerName := key[len("x-proxy-header-"):]
				for _, value := range values {
					req.Header.Set(headerName, value)
				}
			}
		}

		// Make the request
		client := http.DefaultClient

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("Error fetching proxied URL: %v\n", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for key, values := range resp.Header {
			for _, value := range values {
				w.Header().Set(key, value)
			}
		}

		// Set status code and copy body
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}
