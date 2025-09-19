package server

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
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

		tpl := template.Must(template.New("auth").Parse(string(data)))

		templateData := struct {
			HostPrefix string
			SpaceName  string
		}{
			HostPrefix: spaceConfig.HostURLPrefix,
			SpaceName:  spaceConfig.SpaceName,
		}

		w.Header().Set("Content-type", "text/html")
		w.WriteHeader(http.StatusOK)
		if err := tpl.Execute(w, templateData); err != nil {
			log.Printf("Could not render auth page: %v", err)
			w.Write([]byte("Server error"))
		}
	})

	// Auth POST endpoint
	r.Post("/.auth", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
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
			http.Redirect(w, r, applyURLPrefix("/.auth?error=0", spaceConfig.HostURLPrefix), http.StatusFound)
			return
		}

		if spaceConfig.LockoutTimer.IsLocked() {
			log.Println("Authentication locked out, redirecting to auth page.")
			http.Redirect(w, r, applyURLPrefix("/.auth?error=2", spaceConfig.HostURLPrefix), http.StatusFound)
			return
		}

		if username == spaceConfig.Auth.User && password == spaceConfig.Auth.Pass {
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

			http.Redirect(w, r, applyURLPrefix(redirectPath, spaceConfig.HostURLPrefix), http.StatusFound)
		} else {
			log.Println("Authentication failed, redirecting to auth page.")
			spaceConfig.LockoutTimer.AddCount()

			http.Redirect(w, r, applyURLPrefix("/.auth?error=1", spaceConfig.HostURLPrefix), http.StatusFound)
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
						log.Println("Unauthorized token access")
						http.Error(w, "Unauthorized", http.StatusUnauthorized)
						return
					}
				}
			}

			if authCookie == "" {
				log.Printf("Unauthorized access to %s, redirecting to auth page", path)
				redirectToAuth(w, "/.auth", path, spaceConfig.HostURLPrefix)
				return
			}

			// Verify JWT
			claims, err := spaceConfig.JwtIssuer.VerifyAndDecodeJWT(authCookie)
			if err != nil {
				log.Printf("Error verifying JWT on %s, redirecting to auth page: %v\n", path, err)
				redirectToAuth(w, "/.auth", path, spaceConfig.HostURLPrefix)
				return
			}

			username, ok := claims["username"].(string)
			if !ok || username != spaceConfig.Auth.User {
				log.Printf("Username mismatch in JWT on %s", path)
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
