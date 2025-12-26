package server

import (
	"errors"
)

type ReadOnlySpacePrimitives struct {
	wrapped SpacePrimitives
}

var _ SpacePrimitives = &ReadOnlySpacePrimitives{}

// ErrNotAllowed is returned when attempting write operations in read-only mode
var ErrNotAllowed = errors.New("not allowed")

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
	return FileMeta{}, ErrNotAllowed
}

// DeleteFile returns an error since this is a read-only implementation
func (ro *ReadOnlySpacePrimitives) DeleteFile(path string) error {
	return ErrNotAllowed
}
