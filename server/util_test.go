package server

import (
	"testing"
)

func TestLookupContentTypeFromPath(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected string
	}{
		// Specific file types we handle
		{
			name:     "markdown file",
			path:     "document.md",
			expected: "text/markdown",
		},
		{
			name:     "HEIF file",
			path:     "photo.heif",
			expected: "image/heic",
		},
		// Mixed case and path and specific file type
		{
			name:     "mixed case HEIC",
			path:     "/path/to/image.HeIc",
			expected: "image/heic",
		},

		// Special characters
		{
			name:     "unicode filename",
			path:     "фото.heic",
			expected: "image/heic",
		},
		{
			name:     "filename with hyphen underscore",
			path:     "my-file_v2.md",
			expected: "text/markdown",
		},

		// Well-known extensions (system handled)
		{
			name:     "JPEG file",
			path:     "/path/to/image.jpg",
			expected: "image/jpeg",
		},
		{
			name:     "PNG file",
			path:     "image.png",
			expected: "image/png",
		},
		{
			name:     "PDF file",
			path:     "document.pdf",
			expected: "application/pdf",
		},

		// Unknown extension
		{
			name:     "unknown extension",
			path:     "file.unknownext",
			expected: "application/octet-stream",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := LookupContentTypeFromPath(tt.path)
			if result != tt.expected {
				t.Errorf("LookupContentTypeFromPath(%q) = %q, expected %q", tt.path, result, tt.expected)
			}
		})
	}
}
