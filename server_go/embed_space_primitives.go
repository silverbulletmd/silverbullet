package server_go

import (
	"fmt"
	"io/fs"
	"mime"
	"path/filepath"
	"strings"
	"time"
)

type FSSpacePrimitives struct {
	fsys      fs.FS
	wrapped   SpacePrimitives
	rootPath  string // Root path within the fs.FS
	timeStamp time.Time
}

var _ SpacePrimitives = &FSSpacePrimitives{}

func NewFSSpacePrimitives(fsys fs.FS, rootPath string, timeStamp time.Time, wrapped SpacePrimitives) *FSSpacePrimitives {
	// Clean the root path
	cleanRootPath := strings.Trim(rootPath, "/")
	if cleanRootPath != "" && !strings.HasSuffix(cleanRootPath, "/") {
		cleanRootPath += "/"
	}

	return &FSSpacePrimitives{
		fsys:      fsys,
		wrapped:   wrapped,
		rootPath:  cleanRootPath,
		timeStamp: timeStamp,
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
		Created:      e.timeStamp.UnixMilli(),
		LastModified: e.timeStamp.UnixMilli(),
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

	// Append the wrapped file list as well
	wrappedFiles, err := e.wrapped.FetchFileList()
	if err != nil {
		// If fallback fails, just return embedded files
		return allFiles, nil
	}

	allFiles = append(allFiles, wrappedFiles...)

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
