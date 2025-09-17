package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

const authPagePath = ".client/auth.html"

var excludedPaths = []string{
	"/manifest.json",
	"/favicon.png",
	"/logo.png",
	"/.auth",
	"/.logout",
	"/.ping",
}

func addAuthEndpoints(r chi.Router, config *ServerConfig, jwtIssuer *Authenticator, lockoutTimer *LockoutTimer) {
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
		data, _, err := config.ClientBundle.ReadFile(authPagePath)
		if err != nil {
			http.Error(w, "Auth page not found", http.StatusNotFound)
			return
		}

		htmlContent := string(data)
		htmlContent = strings.ReplaceAll(htmlContent, "{{HOST_URL_PREFIX}}", config.HostURLPrefix)

		render.HTML(w, r, htmlContent)
	})

	// Auth POST endpoint
	r.Post("/.auth", func(w http.ResponseWriter, r *http.Request) {
		username := parseFormValue(r, "username")
		password := parseFormValue(r, "password")
		rememberMe := parseFormValue(r, "rememberMe")
		from := parseFormValue(r, "from")

		if username == "" || password == "" {
			w.Header().Set("Location", applyURLPrefix("/.auth?error=0", config.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
			return
		}

		if lockoutTimer.IsLocked() {
			fmt.Println("Authentication locked out, redirecting to auth page.")
			w.Header().Set("Location", applyURLPrefix("/.auth?error=2", config.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
			return
		}

		if username == config.Auth.User && password == config.Auth.Pass {
			// Generate JWT
			payload := map[string]any{
				"username": username,
			}

			var jwt string
			var err error
			if rememberMe != "" {
				jwt, err = jwtIssuer.CreateJWT(payload) // No expiry
			} else {
				jwt, err = jwtIssuer.CreateJWT(payload, authenticationExpirySeconds)
			}

			if err != nil {
				fmt.Printf("Failed to create JWT: %v\n", err)
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}

			host := extractHost(r)
			inAWeek := time.Now().Add(time.Duration(authenticationExpirySeconds) * time.Second)

			cookieOptions := CookieOptions{
				Path:    fmt.Sprintf("%s/", config.HostURLPrefix),
				Expires: inAWeek,
			}

			setCookie(w, authCookieName(host), jwt, cookieOptions)

			if rememberMe != "" {
				setCookie(w, "refreshLogin", "true", cookieOptions)
			}

			redirectPath := "/"
			if from != "" {
				redirectPath = from
			}

			w.Header().Set("Location", applyURLPrefix(redirectPath, config.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
		} else {
			fmt.Println("Authentication failed, redirecting to auth page.")
			lockoutTimer.AddCount()
			w.Header().Set("Location", applyURLPrefix("/.auth?error=1", config.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
		}
	})
}

// authMiddleware provides authentication middleware
func authMiddleware(config *ServerConfig, jwtIssuer *Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := removeURLPrefix(r.URL.Path, config.HostURLPrefix)
			host := extractHost(r)

			if isExcludedPath(path, excludedPaths) {
				next.ServeHTTP(w, r)
				return
			}

			authCookie := getCookie(r, authCookieName(host))

			// Try Bearer token authentication if no cookie
			if authCookie == "" && config.Auth.AuthToken != "" {
				authHeader := r.Header.Get("Authorization")
				if after, ok := strings.CutPrefix(authHeader, "Bearer "); ok {
					authToken := after
					if authToken == config.Auth.AuthToken {
						next.ServeHTTP(w, r)
						return
					} else {
						fmt.Println("Unauthorized token access")
						http.Error(w, "Unauthorized", http.StatusUnauthorized)
						return
					}
				}
			}

			if authCookie == "" {
				fmt.Println("Unauthorized access, redirecting to auth page")
				redirectToAuth(w, "/.auth", path, config.HostURLPrefix)
				return
			}

			// Verify JWT
			claims, err := jwtIssuer.VerifyAndDecodeJWT(authCookie)
			if err != nil {
				fmt.Printf("Error verifying JWT, redirecting to auth page: %v\n", err)
				redirectToAuth(w, "/.auth", path, config.HostURLPrefix)
				return
			}

			username, ok := claims["username"].(string)
			if !ok || username != config.Auth.User {
				fmt.Println("Username mismatch in JWT")
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
				Path:    fmt.Sprintf("%s/", config.HostURLPrefix),
				Expires: inAWeek,
			}

			setCookie(w, authCookieName(host), jwt, cookieOptions)
			setCookie(w, "refreshLogin", "true", cookieOptions)
		}
	}
}
