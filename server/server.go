package server

import (
	"fmt"
	"log"
	"net/http"

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

	// Whether or not the client should push logs to the server
	LogPush bool `json:"logPush"`
}

func RunServer(config *ServerConfig) error {
	r := chi.NewRouter()

	if config.EnableHTTPLogging {
		r.Use(middleware.Logger)
	}

	r.Use(middleware.RealIP)
	r.Use(middleware.Compress(5, "application/json", "text/markdown", "text/javascript", "text/html", "text/css", "text/plain"))

	// Expose space primitives and path to the request
	r.Use(spaceMiddleware(config))

	// Authentication middleware (applies to all routes after this point)
	r.Use(authMiddleware(config))

	// Authentication endpoints (must come before auth middleware)
	addAuthEndpoints(r, config)

	routes := chi.NewRouter()

	routes.Get("/.ping", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Space-Path", spaceConfig.SpaceFolderPath)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Mount filesystem routes under /.fs
	routes.Mount("/.fs", buildFsRoutes())

	// Config endpoint
	routes.Get("/.config", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		clientConfig := &BootConfig{
			SpaceFolderPath: spaceConfig.SpaceFolderPath,
			IndexPage:       spaceConfig.IndexPage,
			ReadOnly:        spaceConfig.ReadOnlyMode,
			LogPush:         spaceConfig.LogPush,
		}

		w.Header().Set("Cache-Control", "no-cache")
		render.JSON(w, r, clientConfig)
	})

	// Shell endpoint
	routes.Post("/.shell", handleShellEndpoint)

	// Log collection endpoint
	routes.Post("/.logs", handleLogsEndpoint)

	// Proxy endpoint
	routes.HandleFunc("/.proxy/*", proxyHandler)

	// Manifest endpoint
	routes.HandleFunc("/.client/manifest.json", manifestHandler)

	routes.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		path := chi.URLParam(r, "*")

		spaceConfig := spaceConfigFromContext(r.Context())

		// See if it's in the client bundle
		data, meta, err := config.ClientBundle.ReadFile(path)
		if err == nil {
			// File is in the bundle, let's serve it
			if r.Header.Get("If-Modified-Since") == utcDateString(meta.LastModified) {
				w.WriteHeader(304)
				return
			}
			w.Header().Set("Content-Type", meta.ContentType)
			w.Header().Set("Last-Modified", utcDateString(meta.LastModified))
			w.WriteHeader(200)
			w.Write(data)
			return
		}

		// TODO: handle request types
		ServerSideRender(config, spaceConfig, path, w, r)
	})

	if config.HostURLPrefix == "" {
		r.Mount("/", routes)
	} else {
		r.Mount(config.HostURLPrefix, routes)
	}

	// Display the final server running message
	visibleHostname := config.BindHost
	if config.BindHost == "127.0.0.1" {
		visibleHostname = "localhost"
	}
	log.Printf("SilverBullet is now running: http://%s:%d", visibleHostname, config.Port)

	http.ListenAndServe(fmt.Sprintf("%s:%d", config.BindHost, config.Port), r)
	return nil
}
