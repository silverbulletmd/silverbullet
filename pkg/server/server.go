package server

import (
	"fmt"
	"log"
	"net/http"
	"path"
	"strings"

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

	// Initialize authentication components
	var jwtIssuer *Authenticator
	var lockoutTimer *LockoutTimer
	var err error

	if config.Auth != nil {
		jwtIssuer, err = CreateAuthenticator(path.Join(config.SpaceFolderPath, ".silverbullet.auth.json"), config.Auth)
		if err != nil {
			return err
		}

		// Initialize lockout timer
		if config.Auth.LockoutLimit > 0 {
			lockoutTimer = NewLockoutTimer(config.Auth.LockoutTime*1000, config.Auth.LockoutLimit)
		} else {
			lockoutTimer = NewLockoutTimer(0, 0) // disabled
		}

		// Authentication middleware (applies to all routes after this point)
		r.Use(authMiddleware(config, jwtIssuer))

		// Authentication endpoints (must come before auth middleware)
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
	r.Post("/.shell", handleShellEndpoint(config))

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
	log.Printf("Now going to listen on hostname %s and port %d", config.Hostname, config.Port)
	http.ListenAndServe(fmt.Sprintf("%s:%d", config.Hostname, config.Port), r)
	return nil
}
