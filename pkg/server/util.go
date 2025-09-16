package server

import (
	"mime"
	"path/filepath"
)

// lookupContentTypeFromPath determines MIME type based on file extension
func LookupContentTypeFromPath(path string) string {
	ext := filepath.Ext(path)
	if ext == "md" {
		return "text/markdown"
	}
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		return "application/octet-stream"
	}
	return contentType
}
