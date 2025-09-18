package server

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// buildFsRoutes creates the filesystem API routes
func buildFsRoutes(spacePrimitives SpacePrimitives, spacePath string) http.Handler {
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
			w.Header().Set("X-Space-Path", spacePath)
			render.JSON(w, r, files)

		} else {
			// Otherwise, redirect to the UI
			http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		}
	})

	// File operations
	fsRouter.Get("/*", handleFsGet(spacePrimitives))
	fsRouter.Put("/*", handleFsPut(spacePrimitives))
	fsRouter.Delete("/*", handleFsDelete(spacePrimitives))
	fsRouter.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, PUT, DELETE, OPTIONS")
		w.WriteHeader(http.StatusOK)
	})

	return fsRouter
}

// handleFsGet handles GET requests for individual files
func handleFsGet(spacePrimitives SpacePrimitives) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path, err := getPath(w, r)

		if err != nil {
			// Handled by getPath
			return
		}

		// log.Printf("Got this path: %s", path)

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
		path, err := getPath(w, r)

		if err != nil {
			// Handled by getPath
			return
		}

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
		path, err := getPath(w, r)

		if err != nil {
			// Handled by getPath
			return
		}

		fmt.Printf("Deleting file: %s\n", path)

		err = spacePrimitives.DeleteFile(path)
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

func getPath(w http.ResponseWriter, r *http.Request) (string, error) {
	path, err := url.QueryUnescape(chi.URLParam(r, "*"))

	if err != nil {
		log.Printf("Could not decode URL: %s: %v", path, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return "", err
	}
	return path, nil
}
