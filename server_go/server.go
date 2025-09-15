package server_go

import (
	"embed"
	"fmt"
	"mime"
	"net/http"
	"strings"

	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/chi/v5"
)

const indexHtmlPath = "dist_client_bundle/.client/index.html"

func RunServer(bundledFiles embed.FS) {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	files, _ := bundledFiles.ReadDir("dist_client_bundle")
	fmt.Println(files)

	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path[1:]

		// See if it's in the client bundle
		data, err := bundledFiles.ReadFile(fmt.Sprintf("dist_client_bundle/%s", path))
		if err == nil {
			w.Header().Set("Content-Type", mime.TypeByExtension(path))
			w.WriteHeader(200)
			w.Write(data)
			return
		}
		// See if it's in the plug bundle
		if cleanPath, ok := strings.CutPrefix(path, ".fs/"); ok {
			data, err = bundledFiles.ReadFile(fmt.Sprintf("dist_plug_bundle/%s", cleanPath))
			if err == nil {
				w.Header().Set("Content-Type", mime.TypeByExtension(cleanPath))
				w.WriteHeader(200)
				w.Write(data)
				return
			}
		}
		data, _ = bundledFiles.ReadFile(indexHtmlPath)
		w.WriteHeader(http.StatusNotFound)
		w.Write(data)
	})
	http.ListenAndServe(":3001", r)
}
