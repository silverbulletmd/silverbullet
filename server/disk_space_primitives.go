package server

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	ignore "github.com/Diogenesoftoronto/go-gitignore"
	"github.com/charlievieth/fastwalk"
	"github.com/djherbis/times"
)

// DiskSpacePrimitives implements SpacePrimitives for local disk storage
type DiskSpacePrimitives struct {
	rootPath  string
	gitIgnore *ignore.GitIgnore
}

var _ SpacePrimitives = &DiskSpacePrimitives{}

// NewDiskSpacePrimitives creates a new DiskSpacePrimitives instance
func NewDiskSpacePrimitives(rootPath string, gitIgnore string) (*DiskSpacePrimitives, error) {
	// Resolve to absolute path
	absPath, err := filepath.Abs(rootPath)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve root path: %w", err)
	}

	// Ensure the directory exists
	if stat, err := os.Stat(absPath); err != nil || !stat.IsDir() {
		return nil, fmt.Errorf("no such directory: %w", err)
	}
	ignore := ignore.CompileIgnoreLines(strings.Split(gitIgnore, "\n")...)

	return &DiskSpacePrimitives{
		rootPath:  absPath,
		gitIgnore: ignore,
	}, nil
}

// safePath ensures the path is within the root directory
func (d *DiskSpacePrimitives) safePath(p string) (string, error) {
	// Clean the path to resolve any .. or . components
	cleanPath := filepath.Clean(p)

	// If the path is absolute and tries to escape, reject it
	if filepath.IsAbs(cleanPath) {
		return "", ErrPathOutsideRoot
	}

	// Make it absolute relative to root
	fullPath := filepath.Join(d.rootPath, cleanPath)

	// Clean the full path again to resolve any remaining .. components
	fullPath = filepath.Clean(fullPath)

	// Ensure the resolved path is still within root
	if !strings.HasPrefix(fullPath, d.rootPath) {
		return "", ErrPathOutsideRoot
	}

	// Additional check: ensure we don't have .. components that could escape
	relPath, err := filepath.Rel(d.rootPath, fullPath)
	if err != nil {
		return "", ErrPathOutsideRoot
	}
	if strings.HasPrefix(relPath, "..") {
		return "", ErrPathOutsideRoot
	}

	return fullPath, nil
}

// filenameToPath converts a relative filename to an absolute path
func (d *DiskSpacePrimitives) filenameToPath(filename string) (string, error) {
	return d.safePath(filename)
}

// pathToFilename converts an absolute path back to a relative filename
func (d *DiskSpacePrimitives) pathToFilename(fullPath string) string {
	if !strings.HasPrefix(fullPath, d.rootPath) {
		return fullPath
	}

	relativePath := strings.TrimPrefix(fullPath, d.rootPath)
	relativePath = strings.TrimPrefix(relativePath, string(filepath.Separator))

	// Normalize path separators to forward slashes
	return strings.ReplaceAll(relativePath, string(filepath.Separator), "/")
}

// fileInfoToFileMeta converts os.FileInfo to FileMeta
func (d *DiskSpacePrimitives) fileInfoToFileMeta(path string, info os.FileInfo) FileMeta {
	return FileMeta{
		Name:         path,
		Size:         info.Size(),
		ContentType:  LookupContentTypeFromPath(path),
		Created:      getCreationTime(info).UnixMilli(),
		LastModified: info.ModTime().UnixMilli(),
		Perm:         "rw",
	}
}

// FetchFileList implements SpacePrimitives.FetchFileList
// Returns a list of files in the space, with the following filtering rules:
// - Hidden files and directories (starting with '.') are excluded at any depth
// - Files without extensions are excluded
// - Files matching gitignore patterns are excluded
func (d *DiskSpacePrimitives) FetchFileList() ([]FileMeta, error) {
	var l sync.Mutex
	var allFiles []FileMeta

	cnf := fastwalk.Config{
		// Follow symlinks
		Follow: true,
	}

	err := fastwalk.Walk(&cnf, d.rootPath, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// Skip files that can't be accessed
			return nil
		}

		// Skip hidden directories and stop traversal into them
		if entry.IsDir() {
			if strings.HasPrefix(entry.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip hidden files
		if strings.HasPrefix(entry.Name(), ".") {
			return nil
		}

		relativePath := d.pathToFilename(path)

		// Exclude ignored files
		if d.gitIgnore.MatchesPath(relativePath) {
			return nil
		}

		// Skip files without extensions
		if filepath.Ext(relativePath) == "" {
			return nil
		}

		// Get file info
		info, err := entry.Info()
		if err != nil {
			// Skip files we can't stat
			return nil
		}

		fileMeta := d.fileInfoToFileMeta(relativePath, info)
		// Mutex to handle concurrent directory walking
		l.Lock()
		allFiles = append(allFiles, fileMeta)
		l.Unlock()

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to walk directory: %w", err)
	}

	return allFiles, nil
}

// GetFileMeta implements SpacePrimitives.GetFileMeta
func (d *DiskSpacePrimitives) GetFileMeta(path string) (FileMeta, error) {
	localPath, err := d.filenameToPath(path)
	if err != nil {
		return FileMeta{}, err
	}

	info, err := os.Stat(localPath)

	if err != nil {
		if os.IsNotExist(err) {
			return FileMeta{}, ErrNotFound
		}
		return FileMeta{}, fmt.Errorf("%w: %s", ErrCouldNotGetMeta, path)
	}

	return d.fileInfoToFileMeta(path, info), nil
}

// CreateDirectory implements SpacePrimitives.CreateDirectory
func (d *DiskSpacePrimitives) CreateDirectory(path string) error {
	localPath, err := d.filenameToPath(path)
	if err != nil {
		return err
	}

	// Check if it already exists
	if _, err := os.Stat(localPath); err == nil {
		return fmt.Errorf("directory already exists: %s", path)
	}

	// Create the directory
	if err := os.MkdirAll(localPath, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", path, err)
	}

	return nil
}

// ReadFile implements SpacePrimitives.ReadFile
func (d *DiskSpacePrimitives) ReadFile(path string) ([]byte, FileMeta, error) {
	localPath, err := d.filenameToPath(path)
	if err != nil {
		return nil, FileMeta{}, err
	}

	// Get file info first
	info, err := os.Stat(localPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, FileMeta{}, ErrNotFound
		}
		return nil, FileMeta{}, fmt.Errorf("failed to stat file %s: %w", path, err)
	}

	// Read file content
	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, FileMeta{}, fmt.Errorf("failed to read file %s: %w", path, err)
	}

	meta := d.fileInfoToFileMeta(path, info)
	return data, meta, nil
}

// WriteFile implements SpacePrimitives.WriteFile
func (d *DiskSpacePrimitives) WriteFile(path string, data []byte, meta *FileMeta) (FileMeta, error) {
	localPath, err := d.filenameToPath(path)
	if err != nil {
		return FileMeta{}, err
	}

	// Ensure parent directory exists
	parentDir := filepath.Dir(localPath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return FileMeta{}, fmt.Errorf("%w: %s", ErrCouldNotWrite, path)
	}

	// Write file
	if err := os.WriteFile(localPath, data, 0644); err != nil {
		return FileMeta{}, fmt.Errorf("%w: %s", ErrCouldNotWrite, path)
	}

	// Set modification time if provided
	if meta != nil && meta.LastModified > 0 {
		modTime := time.UnixMilli(meta.LastModified)
		if err := os.Chtimes(localPath, modTime, modTime); err != nil {
			log.Printf("Failed to set the mtime for %s: %v", localPath, err)
		}
	}

	// Return actual metadata
	return d.GetFileMeta(path)
}

// DeleteFile implements SpacePrimitives.DeleteFile
func (d *DiskSpacePrimitives) DeleteFile(path string) error {
	localPath, err := d.filenameToPath(path)
	if err != nil {
		return err
	}

	if err := os.Remove(localPath); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return fmt.Errorf("failed to delete file %s: %w", path, err)
	}

	// Clean up empty parent directories
	d.cleanOrphaned(localPath)

	return nil
}

// cleanOrphaned removes empty parent directories up to rootPath
func (d *DiskSpacePrimitives) cleanOrphaned(deletedFilePath string) {
	current := filepath.Dir(deletedFilePath)

	for strings.HasPrefix(current, d.rootPath) && current != d.rootPath {
		err := os.Remove(current)
		if err != nil {
			// Directory not empty or other error, stop cleaning
			break
		}
		current = filepath.Dir(current)
	}
}

// This is tricky and OS specific, luckily we found the "times" package that abstracts from the OS-specific details
func getCreationTime(info os.FileInfo) time.Time {
	t := times.Get(info)
	if t.HasBirthTime() {
		return t.BirthTime()
	} else {
		return t.ChangeTime()
	}
}
