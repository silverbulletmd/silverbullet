package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDiskSpacePrimitives(t *testing.T) {
	// Create DiskSpacePrimitives instance
	space, err := NewDiskSpacePrimitives(t.TempDir(), "")
	assert.NoError(t, err, "Failed to create DiskSpacePrimitives")

	// Run all test suites using local testing utilities
	TestSpacePrimitives(t, space)
}

// Test path safety - specific to disk implementation
func TestSafePath(t *testing.T) {
	space, err := NewDiskSpacePrimitives(t.TempDir(), "")
	assert.NoError(t, err, "Failed to create DiskSpacePrimitives")

	// Test that paths outside root are rejected
	_, err = space.safePath("../outside")
	assert.Equal(t, ErrPathOutsideRoot, err, "Expected ErrPathOutsideRoot for '../outside'")

	_, err = space.safePath("/etc/passwd")
	assert.Equal(t, ErrPathOutsideRoot, err, "Expected ErrPathOutsideRoot for '/etc/passwd'")

	// Test that valid paths work
	_, err = space.safePath("valid/path.txt")
	assert.NoError(t, err, "Valid path should not error")

	_, err = space.safePath("./valid.txt")
	assert.NoError(t, err, "Valid relative path should not error")
}

func TestGitIgnore(t *testing.T) {
	space, err := NewDiskSpacePrimitives(t.TempDir(), "*.txt\n*.jpg")
	assert.NoError(t, err, "Failed to create DiskSpacePrimitives")

	// Initially no files
	fileList, err := space.FetchFileList()
	assert.NoError(t, err)
	assert.Len(t, fileList, 0)

	// Write a file matching the gitignore pattern
	_, err = space.WriteFile("test.txt", []byte("Test"), nil)
	assert.NoError(t, err)
	// And one that doesn't
	_, err = space.WriteFile("test.md", []byte("Test"), nil)
	assert.NoError(t, err)

	fileList, err = space.FetchFileList()
	assert.NoError(t, err)
	// Only 1 file
	assert.Len(t, fileList, 1)
	assert.Equal(t, fileList[0].Name, "test.md")

}

func TestHiddenFilesAndDirectories(t *testing.T) {
	space, err := NewDiskSpacePrimitives(t.TempDir(), "")
	assert.NoError(t, err, "Failed to create DiskSpacePrimitives")

	// Create various files and directories
	_, err = space.WriteFile("visible.txt", []byte("visible"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile(".hidden.txt", []byte("hidden"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("dir/.hidden.txt", []byte("hidden in dir"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("dir/visible.txt", []byte("visible in dir"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile(".hidden/visible.txt", []byte("visible in hidden dir"), nil)
	assert.NoError(t, err)

	// Test deeply nested hidden directory
	_, err = space.WriteFile(".hidden/.nested/deep.txt", []byte("deep nested hidden"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("visible/.hidden/nested.txt", []byte("hidden in visible dir"), nil)
	assert.NoError(t, err)

	fileList, err := space.FetchFileList()
	assert.NoError(t, err)

	// Should only contain visible files (not hidden files or files in hidden directories)
	assert.Len(t, fileList, 2)

	fileNames := make([]string, len(fileList))
	for i, file := range fileList {
		fileNames[i] = file.Name
	}

	assert.Contains(t, fileNames, "visible.txt")
	assert.Contains(t, fileNames, "dir/visible.txt")
	assert.NotContains(t, fileNames, ".hidden.txt")
	assert.NotContains(t, fileNames, "dir/.hidden.txt")
	assert.NotContains(t, fileNames, ".hidden/visible.txt")
	assert.NotContains(t, fileNames, ".hidden/.nested/deep.txt")
	assert.NotContains(t, fileNames, "visible/.hidden/nested.txt")
}

func TestFileExtensionRequirement(t *testing.T) {
	space, err := NewDiskSpacePrimitives(t.TempDir(), "")
	assert.NoError(t, err, "Failed to create DiskSpacePrimitives")

	// Create files with and without extensions
	_, err = space.WriteFile("file.txt", []byte("with extension"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("file.md", []byte("with extension"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("noextension", []byte("without extension"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("README", []byte("without extension"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("dir/file.json", []byte("with extension in dir"), nil)
	assert.NoError(t, err)

	_, err = space.WriteFile("dir/noext", []byte("without extension in dir"), nil)
	assert.NoError(t, err)

	fileList, err := space.FetchFileList()
	assert.NoError(t, err)

	// Should only contain files with extensions
	assert.Len(t, fileList, 3)

	fileNames := make([]string, len(fileList))
	for i, file := range fileList {
		fileNames[i] = file.Name
	}

	assert.Contains(t, fileNames, "file.txt")
	assert.Contains(t, fileNames, "file.md")
	assert.Contains(t, fileNames, "dir/file.json")
	assert.NotContains(t, fileNames, "noextension")
	assert.NotContains(t, fileNames, "README")
	assert.NotContains(t, fileNames, "dir/noext")
}

// Test directory cleanup - specific to disk implementation
func TestCleanOrphaned(t *testing.T) {
	tmpDir := t.TempDir()
	space, err := NewDiskSpacePrimitives(tmpDir, "")
	assert.NoError(t, err, "Failed to create DiskSpacePrimitives")

	// Create nested directory structure with a file
	_, err = space.WriteFile("deep/nested/dir/file.txt", []byte("test"), nil)
	assert.NoError(t, err, "Failed to write nested file")

	// Verify the directories were created
	nestedPath := filepath.Join(tmpDir, "deep", "nested", "dir")
	_, err = os.Stat(nestedPath)
	assert.False(t, os.IsNotExist(err), "Nested directory should exist")

	// Delete the file
	err = space.DeleteFile("deep/nested/dir/file.txt")
	assert.NoError(t, err, "Failed to delete nested file")

	_, err = os.Stat(nestedPath)
	assert.True(t, os.IsNotExist(err), "Empty nested directory should be cleaned up")

	deepPath := filepath.Join(tmpDir, "deep")
	_, err = os.Stat(deepPath)
	assert.True(t, os.IsNotExist(err), "Empty parent directory should be cleaned up")
}
