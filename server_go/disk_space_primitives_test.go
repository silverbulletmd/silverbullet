package server_go

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiskSpacePrimitives(t *testing.T) {
	// Create a temporary directory for testing
	tempDir, err := os.MkdirTemp("", "disk_space_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create DiskSpacePrimitives instance
	space, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create DiskSpacePrimitives: %v", err)
	}

	// Run all test suites using local testing utilities
	TestSpacePrimitives(t, space)
}

// Test path safety - specific to disk implementation
func TestSafePath(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "safe_path_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	space, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create DiskSpacePrimitives: %v", err)
	}

	// Test that paths outside root are rejected
	_, err = space.safePath("../outside")
	if err != ErrPathOutsideRoot {
		t.Errorf("Expected ErrPathOutsideRoot for '../outside', got: %v", err)
	}

	_, err = space.safePath("/etc/passwd")
	if err != ErrPathOutsideRoot {
		t.Errorf("Expected ErrPathOutsideRoot for '/etc/passwd', got: %v", err)
	}

	// Test that valid paths work
	_, err = space.safePath("valid/path.txt")
	if err != nil {
		t.Errorf("Valid path should not error: %v", err)
	}

	_, err = space.safePath("./valid.txt")
	if err != nil {
		t.Errorf("Valid relative path should not error: %v", err)
	}
}

// Test directory cleanup - specific to disk implementation
func TestCleanOrphaned(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "clean_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	space, err := NewDiskSpacePrimitives(tempDir)
	if err != nil {
		t.Fatalf("Failed to create DiskSpacePrimitives: %v", err)
	}

	// Create nested directory structure with a file
	_, err = space.WriteFile("deep/nested/dir/file.txt", []byte("test"), nil)
	if err != nil {
		t.Fatalf("Failed to write nested file: %v", err)
	}

	// Verify the directories were created
	nestedPath := filepath.Join(tempDir, "deep", "nested", "dir")
	if _, err := os.Stat(nestedPath); os.IsNotExist(err) {
		t.Error("Nested directory should exist")
	}

	// Delete the file
	err = space.DeleteFile("deep/nested/dir/file.txt")
	if err != nil {
		t.Fatalf("Failed to delete nested file: %v", err)
	}

	if _, err := os.Stat(nestedPath); !os.IsNotExist(err) {
		t.Error("Empty nested directory should be cleaned up")
	}

	deepPath := filepath.Join(tempDir, "deep")
	if _, err := os.Stat(deepPath); !os.IsNotExist(err) {
		t.Error("Empty parent directory should be cleaned up")
	}
}
