package server

import (
	"mime"
	"path/filepath"
	"strings"
)

// Custom MIME type mappings for file extensions not in the system database
var mimeTypeExtMapping = map[string]string{
	".md":   "text/markdown",
	".heic": "image/heic",
	".heif": "image/heic",
}

// lookupContentTypeFromPath determines MIME type based on file extension
func LookupContentTypeFromPath(path string) string {
	ext := strings.ToLower(filepath.Ext(path))

	// Check our custom MIME type mappings first
	if mimeType, exists := mimeTypeExtMapping[ext]; exists {
		return mimeType
	}

	// Fall back to system MIME type detection
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		return "application/octet-stream"
	}
	return contentType
}
