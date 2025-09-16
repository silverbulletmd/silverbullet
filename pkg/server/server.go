package server

import (
	"net/http"
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

func RunServer(config *ServerConfig) {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	// Mount filesystem routes under /.fs
	r.Mount("/.fs", buildFsRoutes(config.SpacePrimitives, config.SpaceFolderPath))

	// Config endpoint
	r.Get("/.config", func(w http.ResponseWriter, r *http.Request) {
		clientConfig := &BootConfig{
			SpaceFolderPath: config.SpaceFolderPath,
			IndexPage:       config.IndexPage,
			ReadOnly:        config.ReadOnlyMode,
		}

		render.JSON(w, r, clientConfig)
	})

	r.Get("/.ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

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
		htmlContent = strings.ReplaceAll(htmlContent, "{{HOST_URL_PREFIX}}", "")
		htmlContent = strings.ReplaceAll(htmlContent, "{{TITLE}}", "SilverBullet")
		htmlContent = strings.ReplaceAll(htmlContent, "{{DESCRIPTION}}", "SilverBullet - A note-taking application")
		htmlContent = strings.ReplaceAll(htmlContent, "{{CONTENT}}", "")

		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(htmlContent))
	})
	http.ListenAndServe(":3001", r)
}
