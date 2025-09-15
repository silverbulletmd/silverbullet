package server_go

import (
	"fmt"
	"io/fs"
	"mime"
	"path/filepath"
	"strings"
	"time"
)

// FSSpacePrimitives implements SpacePrimitives for any filesystem with fallback.
// It serves files from an fs.FS and falls back to another SpacePrimitives implementation
// for files not found in the filesystem.
//
// Supported operations:
// - GetFileMeta: First tries fs.FS, then fallback
// - ReadFile: First tries fs.FS, then fallback
// - FetchFileList: Combines all files from fs.FS and fallback
// - WriteFile: Fails if file exists in fs.FS, otherwise delegates to fallback
// - DeleteFile: Fails if file exists in fs.FS, otherwise delegates to fallback
type FSSpacePrimitives struct {
	fsys     fs.FS
	wrapped  SpacePrimitives
	rootPath string // Root path within the fs.FS
}

var _ SpacePrimitives = &FSSpacePrimitives{}

// NewFSSpacePrimitives creates a new FSSpacePrimitives instance
func NewFSSpacePrimitives(fsys fs.FS, rootPath string, wrapped SpacePrimitives) *FSSpacePrimitives {
	// Clean the root path
	cleanRootPath := strings.Trim(rootPath, "/")
	if cleanRootPath != "" && !strings.HasSuffix(cleanRootPath, "/") {
		cleanRootPath += "/"
	}

	return &FSSpacePrimitives{
		fsys:     fsys,
		wrapped:  wrapped,
		rootPath: cleanRootPath,
	}
}

// pathToEmbedPath converts a relative path to an fs.FS path
func (e *FSSpacePrimitives) pathToEmbedPath(path string) string {
	// Clean the path and remove leading slashes
	cleanPath := strings.Trim(path, "/")

	// Combine with root path
	if e.rootPath == "" {
		return cleanPath
	}

	return e.rootPath + cleanPath
}

// lookupContentTypeFromPath determines MIME type based on file extension
func lookupContentTypeFromPath(path string) string {
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

// fileInfoToFileMeta converts fs.FileInfo to FileMeta for fs.FS files
func (e *FSSpacePrimitives) fileInfoToFileMeta(path string, info fs.FileInfo) FileMeta {
	return FileMeta{
		Name:         path,
		Size:         info.Size(),
		ContentType:  lookupContentTypeFromPath(path),
		Created:      info.ModTime().UnixMilli(),
		LastModified: info.ModTime().UnixMilli(),
		Perm:         "ro", // Embedded files are read-only
	}
}

// FetchFileList implements SpacePrimitives.FetchFileList
// Lists all files from the filesystem first, then combines files from the fallback.
func (e *FSSpacePrimitives) FetchFileList() ([]FileMeta, error) {
	var allFiles []FileMeta

	// First, collect files from the filesystem
	err := fs.WalkDir(e.fsys, strings.TrimRight(e.rootPath, "/"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// Skip files that can't be accessed
			return nil
		}

		// Skip directories
		if entry.IsDir() {
			return nil
		}

		// Get file info
		info, err := entry.Info()
		if err != nil {
			// Skip files we can't stat
			return nil
		}

		// Convert to our path format (forward slashes)
		relativePath := strings.TrimPrefix(path, e.rootPath)
		fileMeta := e.fileInfoToFileMeta(relativePath, info)
		allFiles = append(allFiles, fileMeta)

		return nil
	})

	if err != nil {
		// If we can't walk the filesystem, fall back only
		if e.wrapped != nil {
			return e.wrapped.FetchFileList()
		}
		return nil, fmt.Errorf("failed to walk filesystem: %w", err)
	}

	// If we have a fallback, get its files too and add them all
	if e.wrapped != nil {
		fallbackFiles, err := e.wrapped.FetchFileList()
		if err != nil {
			// If fallback fails, just return embedded files
			return allFiles, nil
		}

		// Add all fallback files (no deduplication)
		allFiles = append(allFiles, fallbackFiles...)
	}

	return allFiles, nil
}

// GetFileMeta implements SpacePrimitives.GetFileMeta
func (e *FSSpacePrimitives) GetFileMeta(path string, observing bool) (FileMeta, error) {
	embedPath := e.pathToEmbedPath(path)

	// Try to get file info from filesystem
	info, err := fs.Stat(e.fsys, embedPath)
	if err == nil && !info.IsDir() {
		return e.fileInfoToFileMeta(path, info), nil
	}

	// If not found in fs.FS, fall back to wrapped implementation
	if e.wrapped != nil {
		return e.wrapped.GetFileMeta(path, observing)
	}

	return FileMeta{}, ErrNotFound
}

// ReadFile implements SpacePrimitives.ReadFile
func (e *FSSpacePrimitives) ReadFile(path string) ([]byte, FileMeta, error) {
	embedPath := e.pathToEmbedPath(path)
	fmt.Println("Getting", embedPath)

	// Try to read from filesystem
	data, err := fs.ReadFile(e.fsys, embedPath)
	if err == nil {
		// Get file info for metadata
		info, statErr := fs.Stat(e.fsys, embedPath)
		if statErr != nil {
			// If we can read but can't stat, create minimal metadata
			meta := FileMeta{
				Name:         path,
				Size:         int64(len(data)),
				ContentType:  lookupContentTypeFromPath(path),
				Created:      time.Now().UnixMilli(),
				LastModified: time.Now().UnixMilli(),
				Perm:         "ro",
			}
			return data, meta, nil
		}

		meta := e.fileInfoToFileMeta(path, info)
		return data, meta, nil
	}

	// If not found in fs.FS, fall back to wrapped implementation
	return e.wrapped.ReadFile(path)
}

// WriteFile implements SpacePrimitives.WriteFile
// Fails if file exists in filesystem, otherwise delegates to fallback
func (e *FSSpacePrimitives) WriteFile(path string, data []byte, meta *FileMeta) (FileMeta, error) {
	embedPath := e.pathToEmbedPath(path)

	// Check if file exists in filesystem
	_, err := fs.Stat(e.fsys, embedPath)
	if err == nil {
		// File exists in filesystem, cannot write
		return FileMeta{}, fmt.Errorf("cannot write file %s: file exists in filesystem", path)
	}

	// File doesn't exist in filesystem, delegate to fallback
	return e.wrapped.WriteFile(path, data, meta)
}

// DeleteFile implements SpacePrimitives.DeleteFile
// Fails if file exists in filesystem, otherwise delegates to fallback
func (e *FSSpacePrimitives) DeleteFile(path string) error {
	embedPath := e.pathToEmbedPath(path)

	// Check if file exists in filesystem
	_, err := fs.Stat(e.fsys, embedPath)
	if err == nil {
		// File exists in filesystem, cannot delete
		return fmt.Errorf("cannot delete file %s: file exists in filesystem", path)
	}

	// File doesn't exist in filesystem, delegate to fallback
	return e.wrapped.DeleteFile(path)
}
