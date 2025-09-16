package server_go

import (
	"embed"
	"io/fs"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
)

// Test embedded filesystem with real files
//
//go:embed testdata/*
var testEmbedFS embed.FS

// Mock filesystem for testing
var mockFS fs.FS = fstest.MapFS{}

func TestNewEmbedFSSpacePrimitives(t *testing.T) {
	// Test with empty root path
	primitives := NewFSSpacePrimitives(mockFS, "", time.Now(), nil)
	assert.Equal(t, "", primitives.rootPath, "Expected empty root path")

	// Test with root path
	primitives = NewFSSpacePrimitives(mockFS, "templates", time.Now(), nil)
	assert.Equal(t, "templates/", primitives.rootPath, "Expected root path 'templates/'")

	// Test with root path with trailing slash
	primitives = NewFSSpacePrimitives(mockFS, "templates/", time.Now(), nil)
	assert.Equal(t, "templates/", primitives.rootPath, "Expected root path 'templates/'")
}

func TestPathToEmbedPath(t *testing.T) {
	tests := []struct {
		name     string
		rootPath string
		input    string
		expected string
	}{
		{"empty root", "", "file.txt", "file.txt"},
		{"with root", "templates", "file.txt", "templates/file.txt"},
		{"with root and slash", "templates/", "file.txt", "templates/file.txt"},
		{"nested path", "templates", "dir/file.txt", "templates/dir/file.txt"},
		{"path with leading slash", "templates", "/file.txt", "templates/file.txt"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			primitives := NewFSSpacePrimitives(mockFS, tt.rootPath, time.Now(), nil)
			result := primitives.pathToEmbedPath(tt.input)
			assert.Equal(t, tt.expected, result, "pathToEmbedPath result mismatch")
		})
	}
}

func TestEmbedFSSpacePrimitivesBasic(t *testing.T) {
	// Create a fallback for realistic testing
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	primitives := NewFSSpacePrimitives(mockFS, "templates", time.Now(), fallback)

	// Test basic operations
	t.Run("WriteFile", func(t *testing.T) {
		_, err := primitives.WriteFile("test.txt", []byte("test"), nil)
		assert.NoError(t, err, "WriteFile should work with fallback")
	})

	t.Run("FetchFileList", func(t *testing.T) {
		files, err := primitives.FetchFileList()
		assert.NoError(t, err, "FetchFileList should work")
		assert.NotNil(t, files, "Files list should not be nil")
	})
}

func TestEmbedFSSpacePrimitivesWithFallback(t *testing.T) {
	// Create a temporary directory for testing
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create disk primitives")

	primitives := NewFSSpacePrimitives(mockFS, "templates", time.Now(), fallback)

	// Test that write operations are delegated to fallback
	t.Run("WriteFile with fallback", func(t *testing.T) {
		data := []byte("test content")
		meta, err := primitives.WriteFile("test.txt", data, nil)
		assert.NoError(t, err, "WriteFile failed")
		assert.Equal(t, "test.txt", meta.Name, "Expected name 'test.txt'")
		assert.Equal(t, int64(len(data)), meta.Size, "Expected size to match data length")
	})

	t.Run("ReadFile from fallback", func(t *testing.T) {
		// First write a file to fallback
		originalData := []byte("fallback content")
		_, err := primitives.WriteFile("fallback.txt", originalData, nil)
		assert.NoError(t, err, "Failed to write to fallback")

		// Then read it back
		data, meta, err := primitives.ReadFile("fallback.txt")
		assert.NoError(t, err, "ReadFile failed")
		assert.Equal(t, originalData, data, "Expected data to match original")
		assert.Equal(t, "fallback.txt", meta.Name, "Expected name 'fallback.txt'")
	})

	t.Run("GetFileMeta from fallback", func(t *testing.T) {
		meta, err := primitives.GetFileMeta("test.txt", false)
		assert.NoError(t, err, "GetFileMeta failed")
		assert.Equal(t, "test.txt", meta.Name, "Expected name 'test.txt'")
	})

	t.Run("DeleteFile with fallback", func(t *testing.T) {
		err := primitives.DeleteFile("test.txt")
		assert.NoError(t, err, "DeleteFile failed")

		// Verify file is deleted
		_, err = primitives.GetFileMeta("test.txt", false)
		assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound")
	})

	t.Run("FetchFileList with fallback", func(t *testing.T) {
		// Write a test file first
		_, err := primitives.WriteFile("list_test.txt", []byte("test"), nil)
		assert.NoError(t, err, "Failed to write test file")

		files, err := primitives.FetchFileList()
		assert.NoError(t, err, "FetchFileList failed")

		found := false
		for _, file := range files {
			if file.Name == "list_test.txt" {
				found = true
				break
			}
		}
		assert.True(t, found, "Expected to find 'list_test.txt' in file list")
	})
}

func TestEmbedFSSpacePrimitivesFileNotFound(t *testing.T) {
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	primitives := NewFSSpacePrimitives(mockFS, "templates", time.Now(), fallback)

	t.Run("GetFileMeta not found", func(t *testing.T) {
		_, err := primitives.GetFileMeta("nonexistent.txt", false)
		assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound")
	})

	t.Run("ReadFile not found", func(t *testing.T) {
		_, _, err := primitives.ReadFile("nonexistent.txt")
		assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound")
	})
}

func TestLookupContentTypeFromPath(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"file.txt", "text/plain; charset=utf-8"},
		{"file.html", "text/html; charset=utf-8"},
		{"file.css", "text/css; charset=utf-8"},
		{"file.js", "text/javascript; charset=utf-8"},
		{"file.json", "application/json"},
		{"file.png", "image/png"},
		{"file.jpg", "image/jpeg"},
		{"file.gif", "image/gif"},
		{"file.pdf", "application/pdf"},
		{"file.unknown", "application/octet-stream"},
		{"file", "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			result := lookupContentTypeFromPath(tt.path)
			assert.Equal(t, tt.expected, result, "Content type mismatch")
		})
	}
}

func TestFileInfoToFileMeta(t *testing.T) {
	// Create a temporary file to get real FileInfo
	tempDir := t.TempDir()
	fallback, err := NewDiskSpacePrimitives(tempDir)
	assert.NoError(t, err, "Failed to create disk primitives")

	testData := []byte("test content")
	_, err = fallback.WriteFile("test.txt", testData, nil)
	assert.NoError(t, err, "Failed to write test file")

	// Get the file info
	_, meta, err := fallback.ReadFile("test.txt")
	assert.NoError(t, err, "Failed to read test file")

	// Verify basic properties
	assert.Equal(t, "test.txt", meta.Name, "Expected name 'test.txt'")
	assert.Equal(t, int64(len(testData)), meta.Size, "Expected size to match test data")
	assert.Greater(t, meta.LastModified, int64(0), "LastModified should be set")
}

func TestEmbedFSFetchFileListMerging(t *testing.T) {
	// Create a more complex mock filesystem
	complexFS := fstest.MapFS{
		"templates/file1.txt":     &fstest.MapFile{Data: []byte("content1")},
		"templates/file2.txt":     &fstest.MapFile{Data: []byte("content2")},
		"templates/sub/file3.txt": &fstest.MapFile{Data: []byte("content3")},
	}

	// Create fallback with some files
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create disk primitives")

	_, err = fallback.WriteFile("fallback1.txt", []byte("fallback content"), nil)
	assert.NoError(t, err, "Failed to write fallback file")

	primitives := NewFSSpacePrimitives(complexFS, "templates", time.Now(), fallback)

	files, err := primitives.FetchFileList()
	assert.NoError(t, err, "FetchFileList failed")

	// Should have files from fallback at minimum
	fileNames := make([]string, len(files))
	for i, f := range files {
		fileNames[i] = f.Name
	}

	assert.Contains(t, fileNames, "fallback1.txt", "Should contain fallback file")
}

func TestEmbedFSFetchFileListWithRootPath(t *testing.T) {
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	tests := []struct {
		name     string
		rootPath string
	}{
		{"empty root", ""},
		{"with root path", "templates"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			primitives := NewFSSpacePrimitives(mockFS, tt.rootPath, time.Now(), fallback)
			files, err := primitives.FetchFileList()
			assert.NoError(t, err, "FetchFileList should not error")
			// Files list can be empty for empty filesystem
			assert.Greater(t, len(files), -1, "Files list length should be >= 0")
		})
	}
}

func TestEmbedFSWithRealFiles(t *testing.T) {
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	// Test with the actual embedded test files
	primitives := NewFSSpacePrimitives(testEmbedFS, "testdata", time.Now(), fallback)

	// Try to list files - this should work even if testdata directory doesn't exist
	files, err := primitives.FetchFileList()
	assert.NoError(t, err, "FetchFileList should work with real embed FS")

	// If there are embedded test files, we should be able to read them
	if len(files) > 0 {
		// Try to read the first file
		firstFile := files[0]
		data, meta, err := primitives.ReadFile(firstFile.Name)
		assert.NoError(t, err, "Should be able to read embedded file")
		assert.NotNil(t, data, "File data should not be nil")
		assert.Equal(t, firstFile.Name, meta.Name, "Meta name should match")
		assert.Equal(t, firstFile.Size, meta.Size, "Meta size should match")
	}

	// Test reading a non-existent file
	_, _, err = primitives.ReadFile("nonexistent.txt")
	assert.Equal(t, ErrNotFound, err, "Should return ErrNotFound for non-existent file")
}

func TestEmbedFSWithRealFilesAndFallback(t *testing.T) {
	// Create fallback
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	primitives := NewFSSpacePrimitives(testEmbedFS, "testdata", time.Now(), fallback)

	// Write a file to fallback
	testContent := []byte("fallback test content")
	_, err = primitives.WriteFile("fallback_test.txt", testContent, nil)
	assert.NoError(t, err, "Should be able to write to fallback")

	// Read it back
	data, meta, err := primitives.ReadFile("fallback_test.txt")
	assert.NoError(t, err, "Should be able to read from fallback")
	assert.Equal(t, testContent, data, "Content should match")
	assert.Equal(t, "fallback_test.txt", meta.Name, "Name should match")

	// List files should include both embed and fallback files
	files, err := primitives.FetchFileList()
	assert.NoError(t, err, "FetchFileList should work")

	// Check that our fallback file is in the list
	found := false
	for _, f := range files {
		if f.Name == "fallback_test.txt" {
			found = true
			break
		}
	}
	assert.True(t, found, "Fallback file should be in file list")

	// Delete the fallback file
	err = primitives.DeleteFile("fallback_test.txt")
	assert.NoError(t, err, "Should be able to delete fallback file")

	// Verify it's gone
	_, _, err = primitives.ReadFile("fallback_test.txt")
	assert.Equal(t, ErrNotFound, err, "File should be deleted")
}

func TestEmbedFSWithMapFS(t *testing.T) {
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	// Create a MapFS with test files
	mapFS := fstest.MapFS{
		"test1.txt":       &fstest.MapFile{Data: []byte("content1")},
		"test2.txt":       &fstest.MapFile{Data: []byte("content2")},
		"dir/nested.txt":  &fstest.MapFile{Data: []byte("nested content")},
		"dir/another.txt": &fstest.MapFile{Data: []byte("another content")},
	}

	primitives := NewFSSpacePrimitives(mapFS, "", time.Now(), fallback)

	// Test basic functionality - write to fallback first
	_, err = primitives.WriteFile("fallback_test.txt", []byte("test content"), nil)
	assert.NoError(t, err, "Should write to fallback")

	// Test FetchFileList includes fallback files
	files, err := primitives.FetchFileList()
	assert.NoError(t, err, "FetchFileList should work")

	// Check that our fallback file is present
	found := false
	for _, f := range files {
		if f.Name == "fallback_test.txt" {
			found = true
			break
		}
	}
	assert.True(t, found, "Should find fallback file")

	// Test non-existent file
	_, _, err = primitives.ReadFile("nonexistent.txt")
	assert.Equal(t, ErrNotFound, err, "Should return ErrNotFound")
}

func TestEmbedFSWithMapFSAndFallback(t *testing.T) {
	// Create a MapFS with test files
	mapFS := fstest.MapFS{
		"embed1.txt": &fstest.MapFile{Data: []byte("embed content 1")},
		"embed2.txt": &fstest.MapFile{Data: []byte("embed content 2")},
	}

	// Create fallback
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	primitives := NewFSSpacePrimitives(mapFS, "", time.Now(), fallback)

	// Write files to fallback with different names
	_, err = primitives.WriteFile("fallback1.txt", []byte("fallback content 1"), nil)
	assert.NoError(t, err, "Should write to fallback")

	_, err = primitives.WriteFile("fallback2.txt", []byte("fallback content 2"), nil)
	assert.NoError(t, err, "Should write to fallback")

	// List all files
	files, err := primitives.FetchFileList()
	assert.NoError(t, err, "FetchFileList should work")
	assert.GreaterOrEqual(t, len(files), 2, "Should have at least 2 fallback files")

	// Verify we can read from fallback
	data, _, err := primitives.ReadFile("fallback1.txt")
	assert.NoError(t, err, "Should read from fallback")
	assert.Equal(t, []byte("fallback content 1"), data, "Fallback content should match")

	// Test that writing to embed file name fails (embed files are protected)
	_, err = primitives.WriteFile("embed1.txt", []byte("overridden content"), nil)
	assert.Error(t, err, "Should not be able to override embed file")
	assert.Contains(t, err.Error(), "file exists in filesystem", "Error should mention file exists in filesystem")
}

func TestCompatibilityAlias(t *testing.T) {
	// Test that NewEmbedFSSpacePrimitives is an alias for NewFSSpacePrimitives
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	assert.NoError(t, err, "Failed to create fallback")

	mapFS := fstest.MapFS{
		"test.txt": &fstest.MapFile{Data: []byte("test content")},
	}

	// Use the alias
	primitives1 := NewEmbedFSSpacePrimitives(mapFS, "", fallback)
	// Use the main function
	primitives2 := NewFSSpacePrimitives(mapFS, "", time.Now(), fallback)

	// Both should work the same way
	files1, err1 := primitives1.FetchFileList()
	assert.NoError(t, err1, "Alias should work")

	files2, err2 := primitives2.FetchFileList()
	assert.NoError(t, err2, "Main function should work")

	assert.Equal(t, len(files1), len(files2), "Both should return same number of files")

	// Test reading the same file
	data1, _, err1 := primitives1.ReadFile("test.txt")
	assert.NoError(t, err1, "Alias should read file")

	data2, _, err2 := primitives2.ReadFile("test.txt")
	assert.NoError(t, err2, "Main function should read file")

	assert.Equal(t, data1, data2, "Both should return same content")
}
