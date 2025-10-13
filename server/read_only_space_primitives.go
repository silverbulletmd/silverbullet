package server

import (
	"errors"
)

type ReadOnlySpacePrimitives struct {
	wrapped SpacePrimitives
}

var _ SpacePrimitives = &ReadOnlySpacePrimitives{}
var NotAllowedError = errors.New("Not allowed")

func NewReadOnlySpacePrimitives(wrapped SpacePrimitives) *ReadOnlySpacePrimitives {
	return &ReadOnlySpacePrimitives{wrapped: wrapped}
}

// FetchFileList retrieves a list of all files in the space
func (ro *ReadOnlySpacePrimitives) FetchFileList() ([]FileMeta, error) {
	return ro.wrapped.FetchFileList()
}

// GetFileMeta retrieves metadata for a specific file
func (ro *ReadOnlySpacePrimitives) GetFileMeta(path string) (FileMeta, error) {
	return ro.wrapped.GetFileMeta(path)
}

// ReadFile reads a file and returns its data and metadata
func (ro *ReadOnlySpacePrimitives) ReadFile(path string) ([]byte, FileMeta, error) {
	return ro.wrapped.ReadFile(path)
}

// WriteFile returns an error since this is a read-only implementation
func (ro *ReadOnlySpacePrimitives) WriteFile(path string, data []byte, meta *FileMeta) (FileMeta, error) {
	return FileMeta{}, NotAllowedError
}

// DeleteFile returns an error since this is a read-only implementation
func (ro *ReadOnlySpacePrimitives) DeleteFile(path string) error {
	return NotAllowedError
}

// CreateDirectory returns an error since this is a read-only implementation
func (ro *ReadOnlySpacePrimitives) CreateDirectory(path string) error {
	return NotAllowedError
}
