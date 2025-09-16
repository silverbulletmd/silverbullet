package server

import (
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
)

const authenticationExpirySeconds = 60 * 60 * 24 * 7 // 1 week

// authCookieName generates a cookie name based on the host
func authCookieName(host string) string {
	// Replace non-word characters with underscores
	re := regexp.MustCompile(`\W`)
	cleanHost := re.ReplaceAllString(host, "_")
	return fmt.Sprintf("auth_%s", cleanHost)
}

// utcDateString converts a timestamp to UTC date string
func utcDateString(mtime int64) string {
	return time.Unix(mtime/1000, 0).UTC().Format(time.RFC1123)
}

// setCookie sets an HTTP cookie
func setCookie(w http.ResponseWriter, name, value string, options CookieOptions) {
	cookie := &http.Cookie{
		Name:  name,
		Value: value,
		Path:  options.Path,
	}

	if !options.Expires.IsZero() {
		cookie.Expires = options.Expires
	}

	if options.HttpOnly {
		cookie.HttpOnly = true
	}

	if options.Secure {
		cookie.Secure = true
	}

	if options.SameSite != "" {
		switch strings.ToLower(options.SameSite) {
		case "strict":
			cookie.SameSite = http.SameSiteStrictMode
		case "lax":
			cookie.SameSite = http.SameSiteLaxMode
		case "none":
			cookie.SameSite = http.SameSiteNoneMode
		}
	}

	http.SetCookie(w, cookie)
}

// getCookie gets an HTTP cookie value
func getCookie(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// deleteCookie deletes an HTTP cookie
func deleteCookie(w http.ResponseWriter, name string, options CookieOptions) {
	cookie := &http.Cookie{
		Name:    name,
		Value:   "",
		Path:    options.Path,
		Expires: time.Unix(0, 0),
		MaxAge:  -1,
	}
	http.SetCookie(w, cookie)
}

// CookieOptions represents cookie configuration options
type CookieOptions struct {
	Path     string
	Expires  time.Time
	HttpOnly bool
	Secure   bool
	SameSite string
}

// extractHost extracts the host from a request
func extractHost(r *http.Request) string {
	host := r.Host
	if host == "" {
		host = r.Header.Get("Host")
	}
	return host
}

// redirectToAuth creates a redirect response to the auth page
func redirectToAuth(w http.ResponseWriter, r *http.Request, authPath, fromPath, hostURLPrefix string) {
	var redirectURL string

	// Try filtering api paths
	if strings.HasPrefix(fromPath, "/.") || strings.HasSuffix(fromPath, ".md") {
		w.Header().Set("Location", applyURLPrefix(authPath, hostURLPrefix))
		w.WriteHeader(http.StatusUnauthorized)
		return
	} else {
		redirectURL = fmt.Sprintf("%s?from=%s", authPath, fromPath)
	}

	w.Header().Set("Location", applyURLPrefix(redirectURL, hostURLPrefix))
	w.WriteHeader(http.StatusFound)
}

// applyURLPrefix applies a URL prefix to a path
func applyURLPrefix(path, prefix string) string {
	if prefix == "" {
		return path
	}
	return prefix + path
}

// removeURLPrefix removes a URL prefix from a path
func removeURLPrefix(path, prefix string) string {
	if prefix == "" {
		return path
	}
	if strings.HasPrefix(path, prefix) {
		return path[len(prefix):]
	}
	return path
}

// isExcludedPath checks if a path should be excluded from authentication
func isExcludedPath(path string, excludedPaths []string) bool {
	return slices.Contains(excludedPaths, path)
}

// parseFormValue safely extracts a form value
func parseFormValue(r *http.Request, key string) string {
	if err := r.ParseForm(); err != nil {
		return ""
	}
	return r.FormValue(key)
}
