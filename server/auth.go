package server

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// path to auth page in the client bundle
const authPagePath = ".client/auth.html"

// These endpoints are not protected by auth
var excludedPaths = []string{
	"/service_worker.js", // because browser fetch this without sending any cookie (auth) headers
	"/.client/",          // to allow a basic UI to load, not 100% sure this is necessary to exclude
	"/.auth",             // otherwise the authentication UI would be behind authentication
	"/.ping",             // because docker needs to be able to access this for its health check
}

func addAuthEndpoints(r chi.Router, config *ServerConfig) {
	// Logout
	r.Get("/.logout", func(w http.ResponseWriter, r *http.Request) {
		host := extractHost(r)
		cookieOptions := CookieOptions{
			Path: fmt.Sprintf("%s/", config.HostURLPrefix),
		}

		deleteCookie(w, authCookieName(host), cookieOptions)
		deleteCookie(w, "refreshLogin", cookieOptions)

		http.Redirect(w, r, applyURLPrefix("/.auth", config.HostURLPrefix), http.StatusFound)
	})

	// Auth page
	r.Get("/.auth", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig, ok := spaceConfigFromContext(r.Context())
		if !ok {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		if spaceConfig.Auth == nil {
			http.Error(w, "Authentication not enabled", http.StatusForbidden)
			return
		}
		if err := spaceConfig.InitAuth(); err != nil {
			http.Error(w, "Failed to initialize authentication", http.StatusInternalServerError)
			return
		}

		data, _, err := config.ClientBundle.ReadFile(authPagePath)
		if err != nil {
			http.Error(w, "Auth page not found", http.StatusNotFound)
			return
		}

		tpl := template.Must(template.New("auth").Parse(string(data)))

		templateData := map[string]string{
			"HostPrefix":     config.HostURLPrefix,
			"SpaceName":      spaceConfig.SpaceName,
			"EncryptionSalt": spaceConfig.JwtIssuer.Salt,
		}

		w.Header().Set("Content-type", "text/html")
		w.WriteHeader(http.StatusOK)
		if err := tpl.Execute(w, templateData); err != nil {
			log.Printf("Could not render auth page: %v", err)
			if _, writeErr := w.Write([]byte("Server error")); writeErr != nil {
				log.Printf("Failed to write error response: %v", writeErr)
			}
		}
	})

	// Auth POST endpoint
	r.Post("/.auth", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig, ok := spaceConfigFromContext(r.Context())
		if !ok {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		if err := spaceConfig.InitAuth(); err != nil {
			http.Error(w, "Failed to initialize authentication", http.StatusInternalServerError)
			return
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Failed to parse form", http.StatusBadRequest)
			return
		}

		username := r.FormValue("username")
		password := r.FormValue("password")
		rememberMe := r.FormValue("rememberMe")
		from := r.FormValue("from")

		if username == "" || password == "" {
			http.Redirect(w, r, applyURLPrefix("/.auth?error=0", config.HostURLPrefix), http.StatusFound)
			return
		}

		if spaceConfig.LockoutTimer.IsLocked() {
			log.Println("Authentication locked out, redirecting to auth page.")
			http.Redirect(w, r, applyURLPrefix("/.auth?error=2", config.HostURLPrefix), http.StatusFound)
			return
		}

		if spaceConfig.Authorize(username, password) {
			// Generate JWT with username (not currently used)
			payload := map[string]any{
				"username": username,
			}

			var jwt string
			var err error
			if rememberMe != "" {
				jwt, err = spaceConfig.JwtIssuer.CreateJWT(payload) // No expiry
			} else {
				jwt, err = spaceConfig.JwtIssuer.CreateJWT(payload, authenticationExpirySeconds)
			}

			if err != nil {
				log.Printf("Failed to create JWT: %v\n", err)
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}

			host := extractHost(r)
			inAWeek := time.Now().Add(time.Duration(authenticationExpirySeconds) * time.Second)

			cookieOptions := CookieOptions{
				Path:     fmt.Sprintf("%s/", config.HostURLPrefix),
				Expires:  inAWeek,
				HttpOnly: true,
				Secure:   r.TLS != nil,
				SameSite: "Lax",
			}

			setCookie(w, authCookieName(host), jwt, cookieOptions)

			if rememberMe != "" {
				setCookie(w, "refreshLogin", "true", cookieOptions)
			}

			from = validateRedirectPath(from)
			redirectPath := applyURLPrefix(from, config.HostURLPrefix)

			render.JSON(w, r, map[string]any{
				"status":   "ok",
				"redirect": redirectPath,
			})
		} else {
			log.Println("Authentication failed, redirecting to auth page.")
			spaceConfig.LockoutTimer.AddCount()

			render.JSON(w, r, map[string]any{
				"status": "error",
				"error":  "Invalid username and/or password",
			})
		}
	})
}

func (spaceConfig *SpaceConfig) InitAuth() error {
	// Use sync.Once to ensure initialization happens exactly once
	// This is the idiomatic Go pattern for thread-safe lazy initialization
	spaceConfig.authOnce.Do(func() {
		// Initialize JWT issuer
		spaceConfig.JwtIssuer, spaceConfig.authErr = CreateAuthenticator(
			path.Join(spaceConfig.SpaceFolderPath, ".silverbullet.auth.json"),
			spaceConfig.Auth,
		)
		if spaceConfig.authErr != nil {
			return
		}

		// Initialize lockout timer
		if spaceConfig.Auth.LockoutLimit > 0 {
			spaceConfig.LockoutTimer = NewLockoutTimer(spaceConfig.Auth.LockoutTime*1000, spaceConfig.Auth.LockoutLimit)
		} else {
			spaceConfig.LockoutTimer = NewLockoutTimer(0, 0) // disabled
		}
	})
	return spaceConfig.authErr
}

// authMiddleware provides authentication middleware
func authMiddleware(config *ServerConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var err error
			spaceConfig, ok := spaceConfigFromContext(r.Context())
			if !ok {
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}
			if spaceConfig.Auth == nil {
				// No authentication to do, moving on
				next.ServeHTTP(w, r)
				return
			}

			path := removeURLPrefix(r.URL.Path, config.HostURLPrefix)
			host := extractHost(r)

			if isExcludedPath(path) {
				next.ServeHTTP(w, r)
				return
			}

			if err := spaceConfig.InitAuth(); err != nil {
				http.Error(w, "Failed to initialize authentication", http.StatusInternalServerError)
				return
			}

			authCookie := getCookie(r, authCookieName(host))

			// Try Bearer token authentication if no cookie
			if authCookie == "" && spaceConfig.Auth.AuthToken != "" {
				authHeader := r.Header.Get("Authorization")
				if after, ok := strings.CutPrefix(authHeader, "Bearer "); ok {
					authToken := after
					if authToken == spaceConfig.Auth.AuthToken {
						next.ServeHTTP(w, r)
						return
					} else {
						log.Println("Unauthorized token access")
						http.Error(w, "Unauthorized", http.StatusUnauthorized)
						return
					}
				}
			}

			if authCookie == "" {
				log.Printf("Unauthorized access to %s, redirecting to auth page", path)
				redirectToAuth(w, "/.auth", path, config.HostURLPrefix)
				return
			}

			// Verify JWT
			claims, err := spaceConfig.JwtIssuer.VerifyAndDecodeJWT(authCookie)
			if err != nil {
				log.Printf("Error verifying JWT on %s, redirecting to auth page: %v\n", path, err)
				redirectToAuth(w, "/.auth", path, config.HostURLPrefix)
				return
			}

			_, ok = claims["username"].(string)
			if !ok {
				log.Printf("Username mismatch in JWT on %s", path)
				redirectToAuth(w, "/.auth", path, config.HostURLPrefix)
				return
			}

			refreshLogin(w, r, config, host)
			next.ServeHTTP(w, r)
		})
	}
}

// refreshLogin refreshes the login cookie if needed
func refreshLogin(w http.ResponseWriter, r *http.Request, config *ServerConfig, host string) {
	if getCookie(r, "refreshLogin") != "" {
		inAWeek := time.Now().Add(time.Duration(authenticationExpirySeconds) * time.Second)
		jwt := getCookie(r, authCookieName(host))

		if jwt != "" {
			cookieOptions := CookieOptions{
				Path:     fmt.Sprintf("%s/", config.HostURLPrefix),
				Expires:  inAWeek,
				HttpOnly: true,
				Secure:   r.TLS != nil,
				SameSite: "Lax",
			}

			setCookie(w, authCookieName(host), jwt, cookieOptions)
			setCookie(w, "refreshLogin", "true", cookieOptions)
		}
	}
}

// LockoutTimer implements a simple rate limiter to prevent brute force attacks
type LockoutTimer struct {
	mutex       sync.Mutex
	bucketTime  int64
	bucketCount int
	bucketSize  int64 // duration in milliseconds
	limit       int
	disabled    bool
}

// NewLockoutTimer creates a new lockout timer
// countPeriodMs: time window in milliseconds
// limit: maximum attempts allowed in the time window
func NewLockoutTimer(countPeriodMs int, limit int) *LockoutTimer {
	disabled := countPeriodMs < 1 || limit < 1

	return &LockoutTimer{
		bucketSize: int64(countPeriodMs),
		limit:      limit,
		disabled:   disabled,
	}
}

// updateBucketTime updates the current bucket time and resets count if needed
func (lt *LockoutTimer) updateBucketTime() {
	currentBucketTime := time.Now().UnixMilli() / lt.bucketSize
	if lt.bucketTime == currentBucketTime {
		return
	}
	// the bucket is too old - empty it
	lt.bucketTime = currentBucketTime
	lt.bucketCount = 0
}

// IsLocked checks if the timer is currently locked due to too many attempts
func (lt *LockoutTimer) IsLocked() bool {
	if lt.disabled {
		return false
	}

	lt.mutex.Lock()
	defer lt.mutex.Unlock()

	lt.updateBucketTime()
	return lt.bucketCount >= lt.limit
}

// AddCount increments the attempt counter
// IsLocked() should be called first to keep bucketTime current
func (lt *LockoutTimer) AddCount() {
	if lt.disabled {
		return
	}

	lt.mutex.Lock()
	defer lt.mutex.Unlock()

	// updateBucketTime should have been called by IsLocked first
	lt.bucketCount++
}
