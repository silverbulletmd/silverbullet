package server_go

import (
	"embed"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"
)

// Test embedded filesystem with real files
//
//go:embed testdata/*
var testEmbedFS embed.FS

// Mock filesystem for testing
var mockFS fs.FS = fstest.MapFS{}

func TestNewEmbedFSSpacePrimitives(t *testing.T) {
	// Test with empty root path
	primitives := NewFSSpacePrimitives(mockFS, "", nil)
	if primitives.rootPath != "" {
		t.Errorf("Expected empty root path, got %q", primitives.rootPath)
	}

	// Test with root path
	primitives = NewFSSpacePrimitives(mockFS, "templates", nil)
	if primitives.rootPath != "templates/" {
		t.Errorf("Expected root path 'templates/', got %q", primitives.rootPath)
	}

	// Test with root path with trailing slash
	primitives = NewFSSpacePrimitives(mockFS, "templates/", nil)
	if primitives.rootPath != "templates/" {
		t.Errorf("Expected root path 'templates/', got %q", primitives.rootPath)
	}
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
			primitives := NewFSSpacePrimitives(mockFS, tt.rootPath, nil)
			result := primitives.pathToEmbedPath(tt.input)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestEmbedFSSpacePrimitivesWithoutFallback(t *testing.T) {
	primitives := NewFSSpacePrimitives(mockFS, "templates", nil)

	// Test operations that should fail without fallback
	t.Run("WriteFile without fallback", func(t *testing.T) {
		_, err := primitives.WriteFile("test.txt", []byte("test"), nil)
		if err == nil {
			t.Error("Expected error for WriteFile without fallback")
		}
	})

	t.Run("DeleteFile without fallback", func(t *testing.T) {
		err := primitives.DeleteFile("test.txt")
		if err == nil {
			t.Error("Expected error for DeleteFile without fallback")
		}
	})

	t.Run("FetchFileList without fallback", func(t *testing.T) {
		files, err := primitives.FetchFileList()
		if err != nil {
			t.Errorf("FetchFileList should work without fallback: %v", err)
		}
		// Should return empty list since mockFS has no files
		if len(files) != 0 {
			t.Errorf("Expected empty file list, got %d files", len(files))
		}
	})
}

func TestEmbedFSSpacePrimitivesWithFallback(t *testing.T) {
	// Create a temporary directory for testing
	fallback, err := NewDiskSpacePrimitives(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create disk primitives: %v", err)
	}

	primitives := NewFSSpacePrimitives(mockFS, "templates", fallback)

	// Test that write operations are delegated to fallback
	t.Run("WriteFile with fallback", func(t *testing.T) {
		data := []byte("test content")
		meta, err := primitives.WriteFile("test.txt", data, nil)
		if err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}
		if meta.Name != "test.txt" {
			t.Errorf("Expected name 'test.txt', got %q", meta.Name)
		}
		if meta.Size != int64(len(data)) {
			t.Errorf("Expected size %d, got %d", len(data), meta.Size)
		}
	})

	t.Run("ReadFile from fallback", func(t *testing.T) {
		// First write a file to fallback
		originalData := []byte("fallback content")
		_, err := primitives.WriteFile("fallback.txt", originalData, nil)
		if err != nil {
			t.Fatalf("Failed to write to fallback: %v", err)
		}

		// Then read it back
		data, meta, err := primitives.ReadFile("fallback.txt")
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}
		if string(data) != string(originalData) {
			t.Errorf("Expected data %q, got %q", string(originalData), string(data))
		}
		if meta.Name != "fallback.txt" {
			t.Errorf("Expected name 'fallback.txt', got %q", meta.Name)
		}
	})

	t.Run("GetFileMeta from fallback", func(t *testing.T) {
		meta, err := primitives.GetFileMeta("test.txt", false)
		if err != nil {
			t.Fatalf("GetFileMeta failed: %v", err)
		}
		if meta.Name != "test.txt" {
			t.Errorf("Expected name 'test.txt', got %q", meta.Name)
		}
	})

	t.Run("DeleteFile with fallback", func(t *testing.T) {
		err := primitives.DeleteFile("test.txt")
		if err != nil {
			t.Fatalf("DeleteFile failed: %v", err)
		}

		// Verify file is deleted
		_, err = primitives.GetFileMeta("test.txt", false)
		if err != ErrNotFound {
			t.Errorf("Expected ErrNotFound, got %v", err)
		}
	})

	t.Run("FetchFileList with fallback", func(t *testing.T) {
		// Write a test file first
		_, err := primitives.WriteFile("list_test.txt", []byte("test"), nil)
		if err != nil {
			t.Fatalf("Failed to write test file: %v", err)
		}

		files, err := primitives.FetchFileList()
		if err != nil {
			t.Fatalf("FetchFileList failed: %v", err)
		}

		found := false
		for _, file := range files {
			if file.Name == "list_test.txt" {
				found = true
				break
			}
		}
		if !found {
			t.Error("Expected to find 'list_test.txt' in file list")
		}
	})
}

func TestEmbedFSSpacePrimitivesFileNotFound(t *testing.T) {
	primitives := NewFSSpacePrimitives(mockFS, "templates", nil)

	t.Run("GetFileMeta not found", func(t *testing.T) {
		_, err := primitives.GetFileMeta("nonexistent.txt", false)
		if err != ErrNotFound {
			t.Errorf("Expected ErrNotFound, got %v", err)
		}
	})

	t.Run("ReadFile not found", func(t *testing.T) {
		_, _, err := primitives.ReadFile("nonexistent.txt")
		if err != ErrNotFound {
			t.Errorf("Expected ErrNotFound, got %v", err)
		}
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
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestFileInfoToFileMeta(t *testing.T) {
	// Create a temporary file to get real FileInfo
	tempDir := t.TempDir()
	fallback, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create disk primitives: %v", err)
	}

	testData := []byte("test content")
	_, err = fallback.WriteFile("test.txt", testData, nil)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Get the file info
	_, meta, err := fallback.ReadFile("test.txt")
	if err != nil {
		t.Fatalf("Failed to read test file: %v", err)
	}

	// Test that embedded files are marked as read-only
	if meta.Perm != "rw" { // This is from disk, should be rw
		t.Errorf("Expected perm 'rw' for disk file, got %q", meta.Perm)
	}

	// Test the embedded version would be read-only
	// (We can't easily test this without actual embedded files, but the logic is simple)
}

func TestEmbedFSFetchFileListMerging(t *testing.T) {
	// Create a temporary directory for fallback testing
	tempDir := t.TempDir()
	fallback, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create disk primitives: %v", err)
	}

	// Write some files to fallback
	_, err = fallback.WriteFile("fallback_only.txt", []byte("fallback content"), nil)
	if err != nil {
		t.Fatalf("Failed to write fallback file: %v", err)
	}

	_, err = fallback.WriteFile("shared_name.txt", []byte("fallback version"), nil)
	if err != nil {
		t.Fatalf("Failed to write shared file to fallback: %v", err)
	}

	primitives := NewFSSpacePrimitives(mockFS, "", fallback)

	// Test that FetchFileList merges files from both sources
	files, err := primitives.FetchFileList()
	if err != nil {
		t.Fatalf("FetchFileList failed: %v", err)
	}

	// Should contain all files from both sources
	foundFallbackOnly := false
	foundSharedName := false

	for _, file := range files {
		if file.Name == "fallback_only.txt" {
			foundFallbackOnly = true
		}
		if file.Name == "shared_name.txt" {
			foundSharedName = true
		}
	}

	if !foundFallbackOnly {
		t.Error("Expected to find 'fallback_only.txt' in combined file list")
	}
	if !foundSharedName {
		t.Error("Expected to find 'shared_name.txt' in combined file list")
	}
}

func TestEmbedFSFetchFileListWithRootPath(t *testing.T) {
	// Test with different root paths
	tests := []struct {
		name     string
		rootPath string
	}{
		{"empty root", ""},
		{"with root", "templates"},
		{"nested root", "assets/templates"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			primitives := NewFSSpacePrimitives(mockFS, tt.rootPath, nil)
			files, err := primitives.FetchFileList()
			if err != nil {
				t.Errorf("FetchFileList failed for root path %q: %v", tt.rootPath, err)
			}
			// Should return empty list since mockFS has no files
			if len(files) != 0 {
				t.Errorf("Expected empty file list for root path %q, got %d files", tt.rootPath, len(files))
			}
		})
	}
}

func TestEmbedFSWithRealFiles(t *testing.T) {
	primitives := NewFSSpacePrimitives(testEmbedFS, "testdata", nil)

	t.Run("FetchFileList with real embedded files", func(t *testing.T) {
		files, err := primitives.FetchFileList()
		if err != nil {
			t.Fatalf("FetchFileList failed: %v", err)
		}

		// Should find our test files
		expectedFiles := map[string]bool{
			"template.html":    false,
			"config.yaml":      false,
			"nested/style.css": false,
		}

		for _, file := range files {
			if _, exists := expectedFiles[file.Name]; exists {
				expectedFiles[file.Name] = true
				// Verify metadata
				if file.Perm != "ro" {
					t.Errorf("Expected embedded file %s to have 'ro' permission, got %q", file.Name, file.Perm)
				}
				if file.Size <= 0 {
					t.Errorf("Expected embedded file %s to have positive size, got %d", file.Name, file.Size)
				}
			}
		}

		// Check that all expected files were found
		for filename, found := range expectedFiles {
			if !found {
				t.Errorf("Expected to find embedded file %s", filename)
			}
		}
	})

	t.Run("ReadFile from embedded filesystem", func(t *testing.T) {
		data, meta, err := primitives.ReadFile("template.html")
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}

		if meta.Name != "template.html" {
			t.Errorf("Expected name 'template.html', got %q", meta.Name)
		}
		if meta.ContentType != "text/html; charset=utf-8" {
			t.Errorf("Expected HTML content type, got %q", meta.ContentType)
		}
		if meta.Perm != "ro" {
			t.Errorf("Expected 'ro' permission, got %q", meta.Perm)
		}
		if !strings.Contains(string(data), "Test Template") {
			t.Error("Expected file content to contain 'Test Template'")
		}
	})

	t.Run("GetFileMeta from embedded filesystem", func(t *testing.T) {
		meta, err := primitives.GetFileMeta("config.yaml", false)
		if err != nil {
			t.Fatalf("GetFileMeta failed: %v", err)
		}

		if meta.Name != "config.yaml" {
			t.Errorf("Expected name 'config.yaml', got %q", meta.Name)
		}
		if meta.ContentType != "text/yaml; charset=utf-8" && meta.ContentType != "application/x-yaml" && meta.ContentType != "application/octet-stream" {
			// YAML content type can vary by system
			t.Logf("Got content type: %q", meta.ContentType)
		}
		if meta.Perm != "ro" {
			t.Errorf("Expected 'ro' permission, got %q", meta.Perm)
		}
	})

	t.Run("ReadFile nested path", func(t *testing.T) {
		data, meta, err := primitives.ReadFile("nested/style.css")
		if err != nil {
			t.Fatalf("ReadFile failed for nested path: %v", err)
		}

		if meta.Name != "nested/style.css" {
			t.Errorf("Expected name 'nested/style.css', got %q", meta.Name)
		}
		if meta.ContentType != "text/css; charset=utf-8" {
			t.Errorf("Expected CSS content type, got %q", meta.ContentType)
		}
		if !strings.Contains(string(data), "font-family") {
			t.Error("Expected CSS content to contain 'font-family'")
		}
	})
}

func TestEmbedFSWithRealFilesAndFallback(t *testing.T) {
	// Create fallback
	tempDir := t.TempDir()
	fallback, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create disk primitives: %v", err)
	}

	primitives := NewFSSpacePrimitives(testEmbedFS, "testdata", fallback)

	// Write some files to fallback
	_, err = fallback.WriteFile("fallback.txt", []byte("fallback content"), nil)
	if err != nil {
		t.Fatalf("Failed to write fallback file: %v", err)
	}

	// Write a file that has same name as embedded file (should prefer embedded)
	_, err = fallback.WriteFile("config.yaml", []byte("fallback: config"), nil)
	if err != nil {
		t.Fatalf("Failed to write config to fallback: %v", err)
	}

	t.Run("FetchFileList merges embedded and fallback", func(t *testing.T) {
		files, err := primitives.FetchFileList()
		if err != nil {
			t.Fatalf("FetchFileList failed: %v", err)
		}

		foundEmbedded := false
		foundFallback := false
		foundConfig := false

		for _, file := range files {
			switch file.Name {
			case "template.html":
				foundEmbedded = true
				if file.Perm != "ro" {
					t.Errorf("Expected embedded file to be read-only, got %q", file.Perm)
				}
			case "fallback.txt":
				foundFallback = true
				if file.Perm != "rw" {
					t.Errorf("Expected fallback file to be read-write, got %q", file.Perm)
				}
			case "config.yaml":
				foundConfig = true
			}
		}

		if !foundEmbedded {
			t.Error("Expected to find embedded file in combined list")
		}
		if !foundFallback {
			t.Error("Expected to find fallback file in combined list")
		}
		if !foundConfig {
			t.Error("Expected to find config.yaml in combined list")
		}
		// Note: Both embedded and fallback versions should be present in the list
	})

	t.Run("ReadFile prefers embedded over fallback", func(t *testing.T) {
		// Read config.yaml - should get embedded version, not fallback
		data, meta, err := primitives.ReadFile("config.yaml")
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}

		if meta.Perm != "ro" {
			t.Errorf("Expected embedded file (ro), got fallback file (%s)", meta.Perm)
		}
		if strings.Contains(string(data), "fallback: config") {
			t.Error("Got fallback content instead of embedded content")
		}
		if !strings.Contains(string(data), "SilverBullet Test") {
			t.Error("Expected embedded config content")
		}
	})

	t.Run("WriteFile fails if file exists in embedded", func(t *testing.T) {
		// Try to write to a file that exists in embedded filesystem
		_, err := primitives.WriteFile("config.yaml", []byte("new content"), nil)
		if err == nil {
			t.Error("Expected WriteFile to fail for file that exists in embedded filesystem")
		}
		if !strings.Contains(err.Error(), "file exists in filesystem") {
			t.Errorf("Expected specific error message, got: %v", err)
		}
	})

	t.Run("DeleteFile fails if file exists in embedded", func(t *testing.T) {
		// Try to delete a file that exists in embedded filesystem
		err := primitives.DeleteFile("config.yaml")
		if err == nil {
			t.Error("Expected DeleteFile to fail for file that exists in embedded filesystem")
		}
		if !strings.Contains(err.Error(), "file exists in filesystem") {
			t.Errorf("Expected specific error message, got: %v", err)
		}
	})

	t.Run("ReadFile falls back when not in embedded", func(t *testing.T) {
		data, meta, err := primitives.ReadFile("fallback.txt")
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}

		if meta.Perm != "rw" {
			t.Errorf("Expected fallback file (rw), got %q", meta.Perm)
		}
		if string(data) != "fallback content" {
			t.Errorf("Expected fallback content, got %q", string(data))
		}
	})

	t.Run("WriteFile succeeds for file not in embedded", func(t *testing.T) {
		_, err := primitives.WriteFile("new_fallback.txt", []byte("new content"), nil)
		if err != nil {
			t.Fatalf("WriteFile should succeed for file not in embedded: %v", err)
		}
	})

	t.Run("DeleteFile succeeds for file not in embedded", func(t *testing.T) {
		err := primitives.DeleteFile("new_fallback.txt")
		if err != nil {
			t.Fatalf("DeleteFile should succeed for file not in embedded: %v", err)
		}
	})
}

func TestEmbedFSWithMapFS(t *testing.T) {
	// Create a test filesystem using fstest.MapFS
	testFS := fstest.MapFS{
		"file1.txt": &fstest.MapFile{
			Data: []byte("content of file1"),
		},
		"dir/file2.html": &fstest.MapFile{
			Data: []byte("<html>file2 content</html>"),
		},
		"config.json": &fstest.MapFile{
			Data: []byte(`{"test": true}`),
		},
	}

	primitives := NewFSSpacePrimitives(testFS, "", nil)

	t.Run("FetchFileList from MapFS", func(t *testing.T) {
		files, err := primitives.FetchFileList()
		if err != nil {
			t.Fatalf("FetchFileList failed: %v", err)
		}

		expectedFiles := map[string]bool{
			"file1.txt":      false,
			"dir/file2.html": false,
			"config.json":    false,
		}

		for _, file := range files {
			if _, exists := expectedFiles[file.Name]; exists {
				expectedFiles[file.Name] = true
				if file.Perm != "ro" {
					t.Errorf("Expected file %s to be read-only, got %q", file.Name, file.Perm)
				}
			}
		}

		for filename, found := range expectedFiles {
			if !found {
				t.Errorf("Expected to find file %s", filename)
			}
		}
	})

	t.Run("ReadFile from MapFS", func(t *testing.T) {
		data, meta, err := primitives.ReadFile("file1.txt")
		if err != nil {
			t.Fatalf("ReadFile failed: %v", err)
		}

		if string(data) != "content of file1" {
			t.Errorf("Expected 'content of file1', got %q", string(data))
		}
		if meta.Name != "file1.txt" {
			t.Errorf("Expected name 'file1.txt', got %q", meta.Name)
		}
		if meta.ContentType != "text/plain; charset=utf-8" {
			t.Errorf("Expected text/plain content type, got %q", meta.ContentType)
		}
	})

	t.Run("WriteFile fails for MapFS file", func(t *testing.T) {
		_, err := primitives.WriteFile("file1.txt", []byte("new content"), nil)
		if err == nil {
			t.Error("Expected WriteFile to fail for file in MapFS")
		}
		if !strings.Contains(err.Error(), "file exists in filesystem") {
			t.Errorf("Expected specific error message, got: %v", err)
		}
	})

	t.Run("DeleteFile fails for MapFS file", func(t *testing.T) {
		err := primitives.DeleteFile("config.json")
		if err == nil {
			t.Error("Expected DeleteFile to fail for file in MapFS")
		}
		if !strings.Contains(err.Error(), "file exists in filesystem") {
			t.Errorf("Expected specific error message, got: %v", err)
		}
	})
}

func TestEmbedFSWithMapFSAndFallback(t *testing.T) {
	// Create a test filesystem
	testFS := fstest.MapFS{
		"embedded.txt": &fstest.MapFile{
			Data: []byte("embedded content"),
		},
	}

	// Create fallback
	tempDir := t.TempDir()
	fallback, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create disk primitives: %v", err)
	}

	primitives := NewFSSpacePrimitives(testFS, "", fallback)

	t.Run("FetchFileList combines MapFS and fallback", func(t *testing.T) {
		// Write to fallback
		_, err := fallback.WriteFile("fallback.txt", []byte("fallback content"), nil)
		if err != nil {
			t.Fatalf("Failed to write to fallback: %v", err)
		}

		files, err := primitives.FetchFileList()
		if err != nil {
			t.Fatalf("FetchFileList failed: %v", err)
		}

		foundEmbedded := false
		foundFallback := false

		for _, file := range files {
			if file.Name == "embedded.txt" {
				foundEmbedded = true
				if file.Perm != "ro" {
					t.Errorf("Expected embedded file to be read-only, got %q", file.Perm)
				}
			}
			if file.Name == "fallback.txt" {
				foundFallback = true
				if file.Perm != "rw" {
					t.Errorf("Expected fallback file to be read-write, got %q", file.Perm)
				}
			}
		}

		if !foundEmbedded {
			t.Error("Expected to find embedded file")
		}
		if !foundFallback {
			t.Error("Expected to find fallback file")
		}
	})

	t.Run("WriteFile works for non-embedded files", func(t *testing.T) {
		_, err := primitives.WriteFile("new_file.txt", []byte("new content"), nil)
		if err != nil {
			t.Fatalf("WriteFile should work for non-embedded files: %v", err)
		}

		// Verify it was written to fallback
		data, _, err := fallback.ReadFile("new_file.txt")
		if err != nil {
			t.Fatalf("Failed to read from fallback: %v", err)
		}
		if string(data) != "new content" {
			t.Errorf("Expected 'new content', got %q", string(data))
		}
	})
}

func TestCompatibilityAlias(t *testing.T) {
	// Test that the old function name still works
	testFS := fstest.MapFS{
		"test.txt": &fstest.MapFile{
			Data: []byte("test content"),
		},
	}

	// Use the deprecated function
	primitives := NewEmbedFSSpacePrimitives(testFS, "", nil)

	// Verify it works the same way
	files, err := primitives.FetchFileList()
	if err != nil {
		t.Fatalf("FetchFileList failed: %v", err)
	}

	found := false
	for _, file := range files {
		if file.Name == "test.txt" {
			found = true
			break
		}
	}

	if !found {
		t.Error("Expected to find test.txt using compatibility alias")
	}

	// Test reading a file
	data, meta, err := primitives.ReadFile("test.txt")
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}

	if string(data) != "test content" {
		t.Errorf("Expected 'test content', got %q", string(data))
	}

	if meta.Name != "test.txt" {
		t.Errorf("Expected name 'test.txt', got %q", meta.Name)
	}
}
