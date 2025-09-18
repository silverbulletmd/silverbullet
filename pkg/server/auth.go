package server

import (
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

const authPagePath = ".client/auth.html"

var excludedPaths = []string{
	"/.client/",
	"/.auth",
	"/.logout",
	"/.ping",
}

func addAuthEndpoints(r chi.Router, config *ServerConfig) {
	// Logout
	r.Get("/.logout", func(w http.ResponseWriter, r *http.Request) {
		host := extractHost(r)
		spaceConfig := spaceConfigFromContext(r.Context())
		cookieOptions := CookieOptions{
			Path: fmt.Sprintf("%s/", spaceConfig.HostURLPrefix),
		}

		deleteCookie(w, authCookieName(host), cookieOptions)
		deleteCookie(w, "refreshLogin", cookieOptions)

		http.Redirect(w, r, applyURLPrefix("/.auth", spaceConfig.HostURLPrefix), http.StatusFound)
	})

	// Auth page
	r.Get("/.auth", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		if err := spaceConfig.InitAuth(); err != nil {
			http.Error(w, "Failed to initialize authentication", http.StatusInternalServerError)
			return
		}

		data, _, err := config.ClientBundle.ReadFile(authPagePath)
		if err != nil {
			http.Error(w, "Auth page not found", http.StatusNotFound)
			return
		}

		htmlContent := string(data)
		htmlContent = strings.ReplaceAll(htmlContent, "{{HOST_URL_PREFIX}}", spaceConfig.HostURLPrefix)

		render.HTML(w, r, htmlContent)
	})

	// Auth POST endpoint
	r.Post("/.auth", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		if err := spaceConfig.InitAuth(); err != nil {
			http.Error(w, "Failed to initialize authentication", http.StatusInternalServerError)
			return
		}
		username := parseFormValue(r, "username")
		password := parseFormValue(r, "password")
		rememberMe := parseFormValue(r, "rememberMe")
		from := parseFormValue(r, "from")

		if username == "" || password == "" {
			w.Header().Set("Location", applyURLPrefix("/.auth?error=0", spaceConfig.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
			return
		}

		if spaceConfig.LockoutTimer.IsLocked() {
			fmt.Println("Authentication locked out, redirecting to auth page.")
			w.Header().Set("Location", applyURLPrefix("/.auth?error=2", spaceConfig.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
			return
		}

		if username == spaceConfig.Auth.User && password == spaceConfig.Auth.Pass {
			// Generate JWT
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
				fmt.Printf("Failed to create JWT: %v\n", err)
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}

			host := extractHost(r)
			inAWeek := time.Now().Add(time.Duration(authenticationExpirySeconds) * time.Second)

			cookieOptions := CookieOptions{
				Path:    fmt.Sprintf("%s/", spaceConfig.HostURLPrefix),
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

			w.Header().Set("Location", applyURLPrefix(redirectPath, spaceConfig.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
		} else {
			fmt.Println("Authentication failed, redirecting to auth page.")
			spaceConfig.LockoutTimer.AddCount()
			w.Header().Set("Location", applyURLPrefix("/.auth?error=1", spaceConfig.HostURLPrefix))
			w.WriteHeader(http.StatusFound)
		}
	})
}

func (spaceConfig *SpaceConfig) InitAuth() error {
	if spaceConfig.JwtIssuer == nil {
		var err error
		// Need to do some initialization
		spaceConfig.JwtIssuer, err = CreateAuthenticator(path.Join(spaceConfig.SpaceFolderPath, ".silverbullet.auth.json"), spaceConfig.Auth)
		if err != nil {
			return err
		}

		// Initialize lockout timer
		if spaceConfig.Auth.LockoutLimit > 0 {
			spaceConfig.LockoutTimer = NewLockoutTimer(spaceConfig.Auth.LockoutTime*1000, spaceConfig.Auth.LockoutLimit)
		} else {
			spaceConfig.LockoutTimer = NewLockoutTimer(0, 0) // disabled
		}
	}
	return nil
}

// authMiddleware provides authentication middleware
func authMiddleware(config *ServerConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var err error
			spaceConfig := spaceConfigFromContext(r.Context())
			if spaceConfig.Auth == nil {
				// No authentication to do, moving on
				next.ServeHTTP(w, r)
				return
			}

			path := removeURLPrefix(r.URL.Path, spaceConfig.HostURLPrefix)
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
						fmt.Println("Unauthorized token access")
						http.Error(w, "Unauthorized", http.StatusUnauthorized)
						return
					}
				}
			}

			if authCookie == "" {
				fmt.Println("Unauthorized access, redirecting to auth page")
				redirectToAuth(w, "/.auth", path, spaceConfig.HostURLPrefix)
				return
			}

			// Verify JWT
			claims, err := spaceConfig.JwtIssuer.VerifyAndDecodeJWT(authCookie)
			if err != nil {
				fmt.Printf("Error verifying JWT, redirecting to auth page: %v\n", err)
				redirectToAuth(w, "/.auth", path, spaceConfig.HostURLPrefix)
				return
			}

			username, ok := claims["username"].(string)
			if !ok || username != spaceConfig.Auth.User {
				fmt.Println("Username mismatch in JWT")
				redirectToAuth(w, "/.auth", path, spaceConfig.HostURLPrefix)
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
		spaceConfig := spaceConfigFromContext(r.Context())
		inAWeek := time.Now().Add(time.Duration(authenticationExpirySeconds) * time.Second)
		jwt := getCookie(r, authCookieName(host))

		if jwt != "" {
			cookieOptions := CookieOptions{
				Path:    fmt.Sprintf("%s/", spaceConfig.HostURLPrefix),
				Expires: inAWeek,
			}

			setCookie(w, authCookieName(host), jwt, cookieOptions)
			setCookie(w, "refreshLogin", "true", cookieOptions)
		}
	}
}
