package server

import (
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
)

const indexHtmlPath = ".client/index.html"

// BootConfig represents the client configuration
type BootConfig struct {
	SpaceFolderPath string `json:"spaceFolderPath"`
	IndexPage       string `json:"indexPage"`
	ReadOnly        bool   `json:"readOnly"`
}

func RunServer(config *ServerConfig) error {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	// Initialize shell backend
	shellBackend := DetermineShellBackend(config)

	// Initialize authentication components
	var jwtIssuer *Authenticator
	var lockoutTimer *LockoutTimer
	var err error

	if config.Auth != nil {
		authString := fmt.Sprintf(`{"auth":{"user":"%s","pass":"%s","lockoutTime":%d,"lockoutLimit":%d}}`,
			config.Auth.User, config.Auth.Pass, config.Auth.LockoutTime, config.Auth.LockoutLimit)
		jwtIssuer, err = CreateAuthenticator(path.Join(config.SpaceFolderPath, ".silverbullet.auth.json"), authString)
		if err != nil {
			return err
		}

		// Initialize lockout timer
		if config.Auth.LockoutLimit > 0 {
			lockoutTimer = NewLockoutTimer(config.Auth.LockoutTime*1000, config.Auth.LockoutLimit)
		} else {
			lockoutTimer = NewLockoutTimer(0, 0) // disabled
		}
	}

	// Authentication middleware (applies to all routes after this point)
	if config.Auth != nil {
		r.Use(authMiddleware(config, jwtIssuer))
	}

	// Authentication endpoints (must come before auth middleware)
	if config.Auth != nil {
		addAuthEndpoints(r, config, jwtIssuer, lockoutTimer)
	}

	r.Get("/.ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Mount filesystem routes under /.fs
	r.Mount("/.fs", buildFsRoutes(config.SpacePrimitives, config.SpaceFolderPath))

	// Config endpoint
	r.Get("/.config", func(w http.ResponseWriter, r *http.Request) {
		clientConfig := &BootConfig{
			SpaceFolderPath: config.SpaceFolderPath,
			IndexPage:       config.IndexPage,
			ReadOnly:        config.ReadOnlyMode,
		}

		w.Header().Set("Cache-Control", "no-cache")
		render.JSON(w, r, clientConfig)
	})

	// Shell endpoint
	r.Post("/.shell", handleShellEndpoint(config, shellBackend))

	// Proxy endpoint
	r.HandleFunc("/.proxy/*", proxyHandler(config))

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := chi.URLParam(r, "*")

		// See if it's in the client bundle
		data, meta, err := config.ClientBundle.ReadFile(path)
		if err == nil {
			w.Header().Set("Content-Type", meta.ContentType)
			w.WriteHeader(200)
			w.Write(data)
			return
		}
		data, _, _ = config.ClientBundle.ReadFile(indexHtmlPath)

		// Replace template variables in index.html
		htmlContent := string(data)
		htmlContent = strings.ReplaceAll(htmlContent, "{{HOST_URL_PREFIX}}", config.HostURLPrefix)
		htmlContent = strings.ReplaceAll(htmlContent, "{{TITLE}}", "SilverBullet")
		htmlContent = strings.ReplaceAll(htmlContent, "{{DESCRIPTION}}", "SilverBullet - A note-taking application")
		htmlContent = strings.ReplaceAll(htmlContent, "{{CONTENT}}", "")

		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(htmlContent))
	})
	http.ListenAndServe(":3001", r)
	return nil
}

// addAuthEndpoints adds authentication-related endpoints
func addAuthEndpoints(r chi.Router, config *ServerConfig, jwtIssuer *Authenticator, lockoutTimer *LockoutTimer) {
	// Logout endpoint
	r.Get("/.logout", func(w http.ResponseWriter, r *http.Request) {
		host := extractHost(r)
		cookieOptions := CookieOptions{
			Path: fmt.Sprintf("%s/", config.HostURLPrefix),
		}

		deleteCookie(w, authCookieName(host), cookieOptions)
		deleteCookie(w, "refreshLogin", cookieOptions)

		w.Header().Set("Location", applyURLPrefix("/.auth", config.HostURLPrefix))
		w.WriteHeader(http.StatusFound)
	})

	// Auth page endpoint
	r.Get("/.auth", func(w http.ResponseWriter, r *http.Request) {
		data, _, err := config.ClientBundle.ReadFile(".client/auth.html")
		if err != nil {
			http.Error(w, "Auth page not found", http.StatusNotFound)
			return
		}

		htmlContent := string(data)
		htmlContent = strings.ReplaceAll(htmlContent, "{{HOST_URL_PREFIX}}", config.HostURLPrefix)

		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(htmlContent))
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
			payload := map[string]interface{}{
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

			fmt.Println("Successful auth")
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
	excludedPaths := []string{
		"/manifest.json",
		"/favicon.png",
		"/logo.png",
		"/.auth",
		"/.logout",
		"/.ping",
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

			path := removeURLPrefix(r.URL.Path, config.HostURLPrefix)

			if isExcludedPath(path, excludedPaths) {
				next.ServeHTTP(w, r)
				return
			}

			host := extractHost(r)
			authCookie := getCookie(r, authCookieName(host))

			// Try Bearer token authentication if no cookie
			if authCookie == "" && config.Auth.AuthToken != "" {
				authHeader := r.Header.Get("Authorization")
				if after, ok := strings.CutPrefix(authHeader, "Bearer "); ok {
					authToken := after
					if authToken == config.Auth.AuthToken {
						refreshLogin(w, r, config, host)
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
				redirectToAuth(w, r, "/.auth", path, config.HostURLPrefix)
				return
			}

			// Verify JWT
			claims, err := jwtIssuer.VerifyAndDecodeJWT(authCookie)
			if err != nil {
				fmt.Printf("Error verifying JWT, redirecting to auth page: %v\n", err)
				redirectToAuth(w, r, "/.auth", path, config.HostURLPrefix)
				return
			}

			username, ok := claims["username"].(string)
			if !ok || username != config.Auth.User {
				fmt.Println("Username mismatch in JWT")
				redirectToAuth(w, r, "/.auth", path, config.HostURLPrefix)
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
