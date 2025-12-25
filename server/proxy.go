package server

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
)

var localhostRegex *regexp.Regexp = regexp.MustCompile(`^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+|host\.docker\.internal)`)

var proxyRequestsTotal = prometheus.NewCounter(prometheus.CounterOpts{
	Name: "silverbullet_proxy_requests",
	Help: "Total number of proxy requests in the SilverBullet space",
})

func init() {
	prometheus.MustRegister(proxyRequestsTotal)
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	spaceConfig, ok := spaceConfigFromContext(r.Context())
	if !ok {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
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

	// Put status code in header
	w.Header().Set("x-proxy-status-code", strconv.Itoa(resp.StatusCode))
	w.Header().Set("content-type", resp.Header.Get("content-type"))
	// Always return 200, to avoid interference, actual status code is in x-proxy-status-code
	w.WriteHeader(http.StatusOK)
	// Copy body
	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("Proxy: failed to copy response body: %v", err)
	}
	proxyRequestsTotal.Inc()
}
