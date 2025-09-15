package server_go

import (
	"embed"
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/chi/v5"
)

const indexHtmlPath = "dist_client_bundle/.client/index.html"

func RunServer(bundledFiles embed.FS) {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path[1:]
		// Extract the file extension from the path
		ext := filepath.Ext(path)

		// See if it's in the client bundle
		data, err := bundledFiles.ReadFile(fmt.Sprintf("dist_client_bundle/%s", path))
		if err == nil {
			w.Header().Set("Content-Type", mime.TypeByExtension(ext))
			w.WriteHeader(200)
			w.Write(data)
			return
		}
		// See if it's in the plug bundle
		if cleanPath, ok := strings.CutPrefix(path, ".fs/"); ok {
			data, err = bundledFiles.ReadFile(fmt.Sprintf("dist_plug_bundle/%s", cleanPath))
			if err == nil {
				w.Header().Set("Content-Type", mime.TypeByExtension(ext))
				w.WriteHeader(200)
				w.Write(data)
				return
			}
		}
		data, _ = bundledFiles.ReadFile(indexHtmlPath)

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
