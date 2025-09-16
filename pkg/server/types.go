package server

import (
	"errors"
)

type ServerConfig struct {
	Hostname string
	Port     int

	SpacePrimitives SpacePrimitives
	SpaceFolderPath string
	IndexPage       string
	GitIgnore       string
	ReadOnlyMode    bool

	ClientBundle SpacePrimitives
}

// FileMeta represents metadata for a file in the space
type FileMeta struct {
	Name         string `json:"name"`
	Created      int64  `json:"created"`
	LastModified int64  `json:"lastModified"`
	ContentType  string `json:"contentType"`
	Size         int64  `json:"size"`
	Perm         string `json:"perm"` // "ro" or "rw"
}

// SpacePrimitives defines the interface for storage backends
type SpacePrimitives interface {
	// FetchFileList retrieves a list of all files in the space
	FetchFileList() ([]FileMeta, error)

	// GetFileMeta retrieves metadata for a specific file
	// observing parameter hints that this file is under regular observation
	GetFileMeta(path string, observing bool) (FileMeta, error)

	// ReadFile reads a file and returns its data and metadata
	ReadFile(path string) ([]byte, FileMeta, error)

	// WriteFile writes data to a file with optional metadata
	// Returns the actual metadata of the written file
	WriteFile(path string, data []byte, meta *FileMeta) (FileMeta, error)

	// DeleteFile removes a file from the space
	DeleteFile(path string) error
}

// Common errors
var (
	ErrNotFound        = errors.New("Not found")
	ErrPathOutsideRoot = errors.New("Path not in space")
	ErrCouldNotWrite   = errors.New("Could not write file")
	ErrCouldNotGetMeta = errors.New("Could not get file metadata")
)
