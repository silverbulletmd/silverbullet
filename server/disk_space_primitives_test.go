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
