package server_go

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/chi/v5"
)

const indexHtmlPath = "dist_client_bundle/.client/index.html"

// BootConfig represents the client configuration
type BootConfig struct {
	SpaceFolderPath string `json:"spaceFolderPath"`
	IndexPage       string `json:"indexPage"`
	ReadOnly        bool   `json:"readOnly"`
}

func RunServer(bundledFiles embed.FS) {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	var spacePrimitives SpacePrimitives
	spacePrimitives, err := NewDiskSpacePrimitives("/Users/zef/tmp")
	if err != nil {
		fmt.Printf("Could not open folder: %v", err)
		os.Exit(1)
	}

	spacePrimitives = NewFSSpacePrimitives(bundledFiles, "dist_plug_bundle", spacePrimitives)

	// Mount filesystem routes under /.fs
	r.Mount("/.fs", buildFsRoutes(spacePrimitives))

	// Config endpoint
	r.Get("/.config", func(w http.ResponseWriter, r *http.Request) {
		clientConfig := BootConfig{
			SpaceFolderPath: "/Users/zef/tmp", // TODO: make configurable
			IndexPage:       "index",          // TODO: make configurable
			ReadOnly:        false,            // TODO: make configurable
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(clientConfig)
	})

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

// buildFsRoutes creates the filesystem API routes
func buildFsRoutes(spacePrimitives SpacePrimitives) chi.Router {
	fsRouter := chi.NewRouter()

	// File list endpoint
	fsRouter.Get("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Sync-Mode") != "" {
			// Handle direct requests for JSON representation of file list
			files, err := spacePrimitives.FetchFileList()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Space-Path", "/Users/zef/tmp") // TODO: make configurable
			json.NewEncoder(w).Encode(files)
		} else {
			// Otherwise, redirect to the UI
			http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		}
	})

	// File operations
	fsRouter.Get("/*", handleFsGet(spacePrimitives))
	fsRouter.Put("/{path:.*}", handleFsPut(spacePrimitives))
	fsRouter.Delete("/{path:.*}", handleFsDelete(spacePrimitives))
	fsRouter.Options("/{path:.*}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, PUT, DELETE, OPTIONS")
		w.WriteHeader(http.StatusOK)
	})

	return fsRouter
}

// handleFsGet handles GET requests for individual files
func handleFsGet(spacePrimitives SpacePrimitives) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract path from URL parameter
		path := strings.TrimLeft(r.URL.Path, "/.fs/")

		fmt.Println("GETTing", path)

		if r.Header.Get("X-Get-Meta") != "" {
			// Getting meta via GET request
			meta, err := spacePrimitives.GetFileMeta(path, false)
			if err != nil {
				if err == ErrNotFound {
					http.NotFound(w, r)
				} else {
					http.Error(w, err.Error(), http.StatusInternalServerError)
				}
				return
			}

			setFileMetaHeaders(w, meta)
			w.WriteHeader(http.StatusOK)
			return
		}

		// Read file content
		data, meta, err := spacePrimitives.ReadFile(path)
		if err != nil {
			if err == ErrNotFound {
				http.NotFound(w, r)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		setFileMetaHeaders(w, meta)
		w.WriteHeader(http.StatusOK)
		w.Write(data)
	}
}

// handleFsPut handles PUT requests for writing files
func handleFsPut(spacePrimitives SpacePrimitives) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract path from URL parameter
		path := strings.TrimLeft(r.URL.Path, "/.fs/")

		// Read request body
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		// Write file
		meta, err := spacePrimitives.WriteFile(path, body, nil)
		if err != nil {
			fmt.Printf("Write failed: %v\n", err)
			http.Error(w, "Write failed", http.StatusInternalServerError)
			return
		}

		setFileMetaHeaders(w, meta)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}
}

// handleFsDelete handles DELETE requests for removing files
func handleFsDelete(spacePrimitives SpacePrimitives) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract path from URL parameter
		path := strings.TrimLeft(r.URL.Path, "/.fs/")

		fmt.Printf("Deleting file: %s\n", path)

		err := spacePrimitives.DeleteFile(path)
		if err != nil {
			if err == ErrNotFound {
				http.NotFound(w, r)
			} else {
				fmt.Printf("Error deleting file: %v\n", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}
}

// setFileMetaHeaders sets HTTP headers based on FileMeta
func setFileMetaHeaders(w http.ResponseWriter, meta FileMeta) {
	w.Header().Set("Content-Type", meta.ContentType)
	w.Header().Set("X-Created", strconv.FormatInt(meta.Created, 10))
	w.Header().Set("X-Last-Modified", strconv.FormatInt(meta.LastModified, 10))
	w.Header().Set("X-Content-Length", strconv.FormatInt(meta.Size, 10))
	w.Header().Set("X-Permission", meta.Perm)
	w.Header().Set("Cache-Contro", "no-cache")
}
