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
}

func RunServer(config *ServerConfig) error {
	r := chi.NewRouter()

	if config.EnableHTTPLogging {
		r.Use(middleware.Logger)
	}

	// Expose space primitives and path to the request
	r.Use(spaceMiddleware(config))

	// Authentication middleware (applies to all routes after this point)
	r.Use(authMiddleware(config))

	// Authentication endpoints (must come before auth middleware)
	addAuthEndpoints(r, config)

	r.Get("/.ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Mount filesystem routes under /.fs
	r.Mount("/.fs", buildFsRoutes())

	// Config endpoint
	r.Get("/.config", func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		clientConfig := &BootConfig{
			SpaceFolderPath: spaceConfig.SpaceFolderPath,
			IndexPage:       spaceConfig.IndexPage,
			ReadOnly:        spaceConfig.ReadOnlyMode,
		}

		w.Header().Set("Cache-Control", "no-cache")
		render.JSON(w, r, clientConfig)
	})

	// Shell endpoint
	r.Post("/.shell", handleShellEndpoint(config))

	// Proxy endpoint
	r.HandleFunc("/.proxy/*", proxyHandler(config))

	// Manifest endpoint
	r.HandleFunc("/.client/manifest.json", manifestHandler(config))

	r.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
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

	// Display the final server running message
	visibleHostname := config.BindHost
	if config.BindHost == "127.0.0.1" {
		visibleHostname = "localhost"
	}
	log.Printf("SilverBullet is now running: http://%s:%d", visibleHostname, config.Port)

	http.ListenAndServe(fmt.Sprintf("%s:%d", config.BindHost, config.Port), r)
	return nil
}
