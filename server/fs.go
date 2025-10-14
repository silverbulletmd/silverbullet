package server

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// buildFsRoutes creates the filesystem API routes with WebDAV support
func buildFsRoutes() http.Handler {
	fsRouter := chi.NewRouter()

	// Root path handlers
	fsRouter.Get("/", handleFsList)

	// File operations (REST API)
	fsRouter.Get("/*", handleFsGet)
	fsRouter.Put("/*", handleFsPut)
	fsRouter.Delete("/*", handleFsDelete)

	// Add WebDAV routes
	buildWebDAVRoutes(fsRouter)

	return fsRouter
}

func handleFsList(w http.ResponseWriter, r *http.Request) {
	spaceConfig := spaceConfigFromContext(r.Context())
	if r.Header.Get("X-Sync-Mode") != "" {
		// Handle direct requests for JSON representation of file list
		files, err := spaceConfig.SpacePrimitives.FetchFileList()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("X-Space-Path", spaceConfig.SpaceFolderPath)
		w.Header().Set("Cache-Control", "no-cache")
		render.JSON(w, r, files)
	} else {
		// Otherwise, redirect to the UI
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	}
}

// handleFsGet handles GET requests for individual files
func handleFsGet(w http.ResponseWriter, r *http.Request) {
	path, err := getPath(w, r)

	spaceConfig := spaceConfigFromContext(r.Context())

	if err != nil {
		// Handled by getPath
		return
	}

	if r.Header.Get("X-Get-Meta") != "" {
		// Getting meta via GET request
		meta, err := spaceConfig.SpacePrimitives.GetFileMeta(path)
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
	data, meta, err := spaceConfig.SpacePrimitives.ReadFile(path)
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

// handleFsPut handles PUT requests for writing files
func handleFsPut(w http.ResponseWriter, r *http.Request) {
	path, err := getPath(w, r)

	spaceConfig := spaceConfigFromContext(r.Context())

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
	meta, err := spaceConfig.SpacePrimitives.WriteFile(path, body, getFileMetaFromHeaders(r.Header, path))
	if err != nil {
		log.Printf("Write failed: %v\n", err)
		http.Error(w, "Write failed", http.StatusInternalServerError)
		return
	}

	setFileMetaHeaders(w, meta)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// handleFsDelete handles DELETE requests for removing files
func handleFsDelete(w http.ResponseWriter, r *http.Request) {
	path, err := getPath(w, r)

	spaceConfig := spaceConfigFromContext(r.Context())

	if err != nil {
		// Handled by getPath
		return
	}

	err = spaceConfig.SpacePrimitives.DeleteFile(path)
	if err != nil {
		if err == ErrNotFound {
			http.NotFound(w, r)
		} else {
			log.Printf("Error deleting file: %v\n", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent) // WebDAV prefers 204 for DELETE
}

// setFileMetaHeaders sets HTTP headers based on FileMeta
func setFileMetaHeaders(w http.ResponseWriter, meta FileMeta) {
	w.Header().Set("Content-Type", meta.ContentType)
	w.Header().Set("X-Created", strconv.FormatInt(meta.Created, 10))
	w.Header().Set("X-Last-Modified", strconv.FormatInt(meta.LastModified, 10))
	w.Header().Set("X-Content-Length", strconv.FormatInt(meta.Size, 10))
	w.Header().Set("X-Permission", meta.Perm)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", fmt.Sprintf("\"%d-%d\"", meta.LastModified, meta.Size))
	w.Header().Set("Last-Modified", time.UnixMilli(meta.LastModified).Format(time.RFC1123))
}

// Build FileMeta from HTTP headers (reverse of setFileMetaHeaders)
func getFileMetaFromHeaders(h http.Header, path string) *FileMeta {
	var err error

	fm := &FileMeta{
		Name:        path,
		ContentType: h.Get("Content-Type"),
		Perm:        h.Get("X-Permission"),
	}
	if fm.Perm == "" {
		fm.Perm = "ro"
	}
	if h.Get("X-Content-Length") != "" {
		fm.Size, err = strconv.ParseInt(h.Get("X-Content-Length"), 10, 64)
		if err != nil {
			log.Printf("Could not parse content length: %v", err)
		}
	} else if h.Get("Content-Length") != "" {
		fm.Size, err = strconv.ParseInt(h.Get("Content-Length"), 10, 64)
		if err != nil {
			log.Printf("Could not parse content length: %v", err)
		}
	}
	if h.Get("X-Created") != "" {
		fm.Created, err = strconv.ParseInt(h.Get("X-Created"), 10, 64)
		if err != nil {
			log.Printf("Could not parse created time: %v", err)
		}
	}
	if h.Get("X-Last-Modified") != "" {
		fm.LastModified, err = strconv.ParseInt(h.Get("X-Last-Modified"), 10, 64)
		if err != nil {
			log.Printf("Could not parse modified time: %v", err)
		}
	}

	return fm
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
