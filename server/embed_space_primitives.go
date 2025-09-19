package server

import (
	"errors"
	"fmt"
	"io/fs"
	pathLib "path"
	"strings"
	"time"
)

// Implements a simple read-only fallthrough implementation of SpacePrimitives, used to serve static files embedde in the Go binary
type ReadOnlyFallthroughSpacePrimitives struct {
	fsys                       fs.FS
	fallthroughSpacePrimitives SpacePrimitives
	rootPath                   string    // Root path within the fs.FS
	timeStamp                  time.Time // Fake timestamp to use for all files
}

var _ SpacePrimitives = &ReadOnlyFallthroughSpacePrimitives{}

func NewReadOnlyFallthroughSpacePrimitives(fsys fs.FS, rootPath string, timeStamp time.Time, wrapped SpacePrimitives) *ReadOnlyFallthroughSpacePrimitives {
	return &ReadOnlyFallthroughSpacePrimitives{
		fsys:                       fsys,
		fallthroughSpacePrimitives: wrapped,
		rootPath:                   rootPath,
		timeStamp:                  timeStamp,
	}
}

// pathToEmbedPath converts a relative path to an fs.FS path
func (e *ReadOnlyFallthroughSpacePrimitives) pathToEmbedPath(path string) string {
	return pathLib.Join(e.rootPath, path)
}

// Inverse of pathToEmbedPath
func (e *ReadOnlyFallthroughSpacePrimitives) embedPathToPath(path string) string {
	return strings.TrimPrefix(path, e.rootPath+"/")
}

// fileInfoToFileMeta converts fs.FileInfo to FileMeta for fs.FS files
func (e *ReadOnlyFallthroughSpacePrimitives) fileInfoToFileMeta(path string, info fs.FileInfo) FileMeta {
	return FileMeta{
		Name:         path,
		Size:         info.Size(),
		ContentType:  LookupContentTypeFromPath(path),
		Created:      e.timeStamp.UnixMilli(),
		LastModified: e.timeStamp.UnixMilli(),
		Perm:         "ro",
	}
}

// FetchFileList implements SpacePrimitives.FetchFileList
// Lists all files from the filesystem first, then combines files from the fallback.
func (e *ReadOnlyFallthroughSpacePrimitives) FetchFileList() ([]FileMeta, error) {
	allFiles := make([]FileMeta, 0, 1000)

	// First, collect files from the filesystem
	err := fs.WalkDir(e.fsys, e.rootPath, func(path string, entry fs.DirEntry, err error) error {
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
		relativePath := e.embedPathToPath(path)
		fileMeta := e.fileInfoToFileMeta(relativePath, info)
		allFiles = append(allFiles, fileMeta)

		return nil
	})

	if err != nil {
		fmt.Printf("Something went wrong listing files in the FS: %v", err)
	}

	wrappedFiles, err := e.fallthroughSpacePrimitives.FetchFileList()
	if err != nil {
		return allFiles, err
	}

	allFiles = append(allFiles, wrappedFiles...)

	return allFiles, nil
}

// GetFileMeta implements SpacePrimitives.GetFileMeta
func (e *ReadOnlyFallthroughSpacePrimitives) GetFileMeta(path string, observing bool) (FileMeta, error) {
	embedPath := e.pathToEmbedPath(path)

	// Try to get file info from filesystem
	info, err := fs.Stat(e.fsys, embedPath)
	if err == nil && !info.IsDir() {
		return e.fileInfoToFileMeta(path, info), nil
	}

	if e.fallthroughSpacePrimitives == nil {
		return FileMeta{}, errors.New("Not found")
	}

	// If not found in fs.FS, fall back
	return e.fallthroughSpacePrimitives.GetFileMeta(path, observing)
}

// ReadFile implements SpacePrimitives.ReadFile
func (e *ReadOnlyFallthroughSpacePrimitives) ReadFile(path string) ([]byte, FileMeta, error) {
	embedPath := e.pathToEmbedPath(path)

	// Try to read from filesystem
	data, err := fs.ReadFile(e.fsys, embedPath)
	if err == nil {
		// Get file info for metadata
		info, statErr := fs.Stat(e.fsys, embedPath)
		if statErr != nil {
			return nil, FileMeta{}, statErr
		}

		return data, e.fileInfoToFileMeta(path, info), nil
	}

	if e.fallthroughSpacePrimitives == nil {
		return nil, FileMeta{}, errors.New("Not found")
	}

	// If not found in fs.FS, fall back
	return e.fallthroughSpacePrimitives.ReadFile(path)
}

// WriteFile implements SpacePrimitives.WriteFile
// Fails if file exists in filesystem, otherwise delegates to fallback
func (e *ReadOnlyFallthroughSpacePrimitives) WriteFile(path string, data []byte, meta *FileMeta) (FileMeta, error) {
	embedPath := e.pathToEmbedPath(path)

	// Check if file exists in filesystem
	_, err := fs.Stat(e.fsys, embedPath)
	if err == nil {
		// File exists in filesystem, cannot write
		return FileMeta{}, fmt.Errorf("Cannot write file %s: read-only", path)
	}

	if e.fallthroughSpacePrimitives == nil {
		return FileMeta{}, errors.New("Not found")
	}

	return e.fallthroughSpacePrimitives.WriteFile(path, data, meta)
}

// DeleteFile implements SpacePrimitives.DeleteFile
// Fails if file exists in filesystem, otherwise delegates to fallback
func (e *ReadOnlyFallthroughSpacePrimitives) DeleteFile(path string) error {
	embedPath := e.pathToEmbedPath(path)

	// Check if file exists in filesystem
	_, err := fs.Stat(e.fsys, embedPath)
	if err == nil {
		// File exists in filesystem, cannot delete
		return fmt.Errorf("cannot delete file %s: read-only file", path)
	}

	if e.fallthroughSpacePrimitives == nil {
		return errors.New("Not found")
	}

	return e.fallthroughSpacePrimitives.DeleteFile(path)
}
