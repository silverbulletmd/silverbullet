package cmd

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// TestExtractZipRenamesExistingFile verifies that extractZip renames existing files
// instead of removing them, which fixes the Windows upgrade issue (#1628)
func TestExtractZipRenamesExistingFile(t *testing.T) {
	// Create a temporary directory for the test
	tmpDir, err := os.MkdirTemp("", "upgrade-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer func() {
		if err := os.RemoveAll(tmpDir); err != nil {
			t.Logf("Warning: failed to clean up temp dir: %v", err)
		}
	}()

	// Create a test zip file
	zipPath := filepath.Join(tmpDir, "test.zip")
	zipFile, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("Failed to create zip file: %v", err)
	}

	zipWriter := zip.NewWriter(zipFile)

	// Add a file to the zip
	fileWriter, err := zipWriter.Create("testfile.txt")
	if err != nil {
		t.Fatalf("Failed to create file in zip: %v", err)
	}

	newContent := "new content"
	if _, err := fileWriter.Write([]byte(newContent)); err != nil {
		t.Fatalf("Failed to write to zip file: %v", err)
	}

	if err := zipWriter.Close(); err != nil {
		t.Fatalf("Failed to close zip writer: %v", err)
	}
	if err := zipFile.Close(); err != nil {
		t.Fatalf("Failed to close zip file: %v", err)
	}

	// Create destination directory
	destDir := filepath.Join(tmpDir, "dest")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatalf("Failed to create dest dir: %v", err)
	}

	// Create an existing file that will be "upgraded"
	existingFilePath := filepath.Join(destDir, "testfile.txt")
	oldContent := "old content"
	if err := os.WriteFile(existingFilePath, []byte(oldContent), 0644); err != nil {
		t.Fatalf("Failed to create existing file: %v", err)
	}

	// Extract the zip
	if err := extractZip(zipPath, destDir); err != nil {
		t.Fatalf("extractZip failed: %v", err)
	}

	// Verify the new file has the new content
	content, err := os.ReadFile(existingFilePath)
	if err != nil {
		t.Fatalf("Failed to read updated file: %v", err)
	}
	if string(content) != newContent {
		t.Errorf("Expected new content %q, got %q", newContent, string(content))
	}

	// Verify the old file was renamed to .old
	oldFilePath := existingFilePath + ".old"
	oldFileContent, err := os.ReadFile(oldFilePath)
	if err != nil {
		t.Fatalf("Failed to read .old file: %v", err)
	}
	if string(oldFileContent) != oldContent {
		t.Errorf("Expected old content %q in .old file, got %q", oldContent, string(oldFileContent))
	}
}

// TestExtractZipHandlesNonExistentFile verifies extractZip works when no existing file is present
func TestExtractZipHandlesNonExistentFile(t *testing.T) {
	// Create a temporary directory for the test
	tmpDir, err := os.MkdirTemp("", "upgrade-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer func() {
		if err := os.RemoveAll(tmpDir); err != nil {
			t.Logf("Warning: failed to clean up temp dir: %v", err)
		}
	}()

	// Create a test zip file
	zipPath := filepath.Join(tmpDir, "test.zip")
	zipFile, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("Failed to create zip file: %v", err)
	}

	zipWriter := zip.NewWriter(zipFile)

	// Add a file to the zip
	fileWriter, err := zipWriter.Create("newfile.txt")
	if err != nil {
		t.Fatalf("Failed to create file in zip: %v", err)
	}

	content := "test content"
	if _, err := fileWriter.Write([]byte(content)); err != nil {
		t.Fatalf("Failed to write to zip file: %v", err)
	}

	if err := zipWriter.Close(); err != nil {
		t.Fatalf("Failed to close zip writer: %v", err)
	}
	if err := zipFile.Close(); err != nil {
		t.Fatalf("Failed to close zip file: %v", err)
	}

	// Create destination directory (but no existing file)
	destDir := filepath.Join(tmpDir, "dest")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		t.Fatalf("Failed to create dest dir: %v", err)
	}

	// Extract the zip
	if err := extractZip(zipPath, destDir); err != nil {
		t.Fatalf("extractZip failed: %v", err)
	}

	// Verify the file was created
	newFilePath := filepath.Join(destDir, "newfile.txt")
	fileContent, err := os.ReadFile(newFilePath)
	if err != nil {
		t.Fatalf("Failed to read new file: %v", err)
	}
	if string(fileContent) != content {
		t.Errorf("Expected content %q, got %q", content, string(fileContent))
	}

	// Verify no .old file was created
	oldFilePath := newFilePath + ".old"
	if _, err := os.Stat(oldFilePath); !os.IsNotExist(err) {
		t.Errorf("Unexpected .old file created when original didn't exist")
	}
}
