package server

import (
	"fmt"
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

func proxyHandler(w http.ResponseWriter, r *http.Request) {
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

	// Copy headers starting with X-Proxy-Header-, removing the prefix
	for key, values := range r.Header {
		if strings.HasPrefix(strings.ToLower(key), "x-proxy-header-") {
			headerName := key[len("x-proxy-header-"):]
			for _, value := range values {
				req.Header.Set(headerName, value)
			}
		}
	}

	// TODO: Replaced with specifically configured client
	client := http.DefaultClient

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error fetching proxied URL: %v\n", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Copy response response header with x-proxy-header prefix to keep things clean
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Set(fmt.Sprintf("x-proxy-header-%s", key), value)
		}
	}

	// Set status code and copy body
	w.Header().Set("content-type", resp.Header.Get("content-type"))
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("Proxy: failed to copy response body: %v", err)
	}
}
