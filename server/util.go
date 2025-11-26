package server

import (
	"mime"
	"path/filepath"
	"strings"
)

// lookupContentTypeFromPath determines MIME type based on file extension
func LookupContentTypeFromPath(path string) string {
	ext := filepath.Ext(path)

	// Handle specific file types that may not be in the system MIME database
	// or need special handling
	if strings.EqualFold(ext, ".md") {
		return "text/markdown"
	}
	if strings.EqualFold(ext, ".heic") {
		return "image/heic"
	}
	if strings.EqualFold(ext, ".heif") {
		return "image/heic"
	}

	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		return "application/octet-stream"
	}
	return contentType
}
