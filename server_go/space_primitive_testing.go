package server_go

import (
	"bytes"
	"testing"
)

// TestSpacePrimitives runs a comprehensive test suite against any SpacePrimitives implementation
func TestSpacePrimitives(t *testing.T, spacePrimitives SpacePrimitives) {
	t.Run("BasicOperations", func(t *testing.T) {
		testBasicOperations(t, spacePrimitives)
	})
	t.Run("FileOverwriting", func(t *testing.T) {
		testFileOverwriting(t, spacePrimitives)
	})
	t.Run("EmptyFiles", func(t *testing.T) {
		testEmptyFiles(t, spacePrimitives)
	})
	t.Run("UnicodeContent", func(t *testing.T) {
		testUnicodeContent(t, spacePrimitives)
	})
	t.Run("SpecialFileNames", func(t *testing.T) {
		testSpecialFileNames(t, spacePrimitives)
	})
	t.Run("ErrorHandling", func(t *testing.T) {
		testErrorHandling(t, spacePrimitives)
	})
	t.Run("LargeFiles", func(t *testing.T) {
		testLargeFiles(t, spacePrimitives)
	})
	t.Run("MetadataPreservation", func(t *testing.T) {
		testMetadataPreservation(t, spacePrimitives)
	})

	// Ensure clean state at the end
	finalFiles, err := spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch final file list: %v", err)
	}
	if len(finalFiles) != 0 {
		t.Errorf("Expected empty file list at end, got %d files", len(finalFiles))
	}
}

func testBasicOperations(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test initial empty state
	files, err := spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch file list: %v", err)
	}
	if len(files) != 0 {
		t.Errorf("Expected empty file list, got %d files", len(files))
	}

	// Write text file
	testContent := []byte("Hello World")
	fileMeta := &FileMeta{
		Name:         "test.txt",
		Perm:         "rw",
		Created:      10,
		ContentType:  "text/plain",
		LastModified: 20,
		Size:         11,
	}

	_, err = spacePrimitives.WriteFile("test.txt", testContent, fileMeta)
	if err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	// Read the file back
	retrievedData, retrievedMeta, err := spacePrimitives.ReadFile("test.txt")
	if err != nil {
		t.Fatalf("Failed to read file: %v", err)
	}

	if !bytes.Equal(retrievedData, testContent) {
		t.Errorf("Retrieved data doesn't match: expected %s, got %s", testContent, retrievedData)
	}

	// Check that the meta data is persisted (lastModified should be preserved)
	if retrievedMeta.LastModified != 20 {
		t.Errorf("Expected lastModified to be 20, got %d", retrievedMeta.LastModified)
	}

	// Check file list
	fileList, err := spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch file list: %v", err)
	}
	if len(fileList) != 1 {
		t.Errorf("Expected 1 file in list, got %d", len(fileList))
	}
	if fileList[0].Name != "test.txt" {
		t.Errorf("Expected file name 'test.txt', got '%s'", fileList[0].Name)
	}

	// Write binary file
	buf := make([]byte, 1024*1024)
	buf[0] = 1
	buf[1] = 2
	buf[2] = 3
	buf[3] = 4
	buf[4] = 5

	_, err = spacePrimitives.WriteFile("test.bin", buf, nil)
	if err != nil {
		t.Fatalf("Failed to write binary file: %v", err)
	}

	fileData, _, err := spacePrimitives.ReadFile("test.bin")
	if err != nil {
		t.Fatalf("Failed to read binary file: %v", err)
	}

	if len(fileData) != 1024*1024 {
		t.Errorf("Expected binary file size %d, got %d", 1024*1024, len(fileData))
	}

	fileList, err = spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch file list: %v", err)
	}
	if len(fileList) != 2 {
		t.Errorf("Expected 2 files in list, got %d", len(fileList))
	}

	// Delete binary file
	err = spacePrimitives.DeleteFile("test.bin")
	if err != nil {
		t.Fatalf("Failed to delete binary file: %v", err)
	}

	fileList, err = spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch file list: %v", err)
	}
	if len(fileList) != 1 {
		t.Errorf("Expected 1 file in list after deletion, got %d", len(fileList))
	}

	// Clean up
	err = spacePrimitives.DeleteFile("test.txt")
	if err != nil {
		t.Fatalf("Failed to delete test file: %v", err)
	}

	fileList, err = spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch file list: %v", err)
	}
	if len(fileList) != 0 {
		t.Errorf("Expected empty file list after cleanup, got %d files", len(fileList))
	}

	// Test weird file names
	weirdContent := []byte("Hello world!")
	_, err = spacePrimitives.WriteFile("test+'s.txt", weirdContent, nil)
	if err != nil {
		t.Fatalf("Failed to write file with weird name: %v", err)
	}

	readWeirdData, _, err := spacePrimitives.ReadFile("test+'s.txt")
	if err != nil {
		t.Fatalf("Failed to read file with weird name: %v", err)
	}

	if !bytes.Equal(readWeirdData, weirdContent) {
		t.Errorf("Weird file content doesn't match: expected %s, got %s", weirdContent, readWeirdData)
	}

	err = spacePrimitives.DeleteFile("test+'s.txt")
	if err != nil {
		t.Fatalf("Failed to delete weird file: %v", err)
	}

	// Check deletion of weird file name
	_, _, err = spacePrimitives.ReadFile("test+'s.txt")
	if err != ErrNotFound {
		t.Errorf("Expected ErrNotFound when reading deleted file, got: %v", err)
	}
}

func testFileOverwriting(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test overwriting existing files
	originalContent := []byte("Original")
	_, err := spacePrimitives.WriteFile("overwrite.txt", originalContent, nil)
	if err != nil {
		t.Fatalf("Failed to write original file: %v", err)
	}

	_, err = spacePrimitives.GetFileMeta("overwrite.txt", false)
	if err != nil {
		t.Fatalf("Failed to get original meta: %v", err)
	}

	updatedContent := []byte("Updated")
	_, err = spacePrimitives.WriteFile("overwrite.txt", updatedContent, nil)
	if err != nil {
		t.Fatalf("Failed to overwrite file: %v", err)
	}

	updatedData, _, err := spacePrimitives.ReadFile("overwrite.txt")
	if err != nil {
		t.Fatalf("Failed to read overwritten file: %v", err)
	}

	if !bytes.Equal(updatedData, updatedContent) {
		t.Errorf("Overwritten content doesn't match: expected %s, got %s", updatedContent, updatedData)
	}

	// File list should still have only one entry for this file
	filesAfterOverwrite, err := spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch files after overwrite: %v", err)
	}

	overwriteFiles := 0
	for _, f := range filesAfterOverwrite {
		if f.Name == "overwrite.txt" {
			overwriteFiles++
		}
	}

	if overwriteFiles != 1 {
		t.Errorf("Expected 1 instance of overwrite.txt, got %d", overwriteFiles)
	}

	err = spacePrimitives.DeleteFile("overwrite.txt")
	if err != nil {
		t.Fatalf("Failed to delete overwritten file: %v", err)
	}
}

func testEmptyFiles(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test empty file
	emptyData := []byte{}
	_, err := spacePrimitives.WriteFile("empty.txt", emptyData, nil)
	if err != nil {
		t.Fatalf("Failed to write empty file: %v", err)
	}

	emptyFileData, emptyFileMeta, err := spacePrimitives.ReadFile("empty.txt")
	if err != nil {
		t.Fatalf("Failed to read empty file: %v", err)
	}

	if len(emptyFileData) != 0 {
		t.Errorf("Expected empty file data length 0, got %d", len(emptyFileData))
	}

	if emptyFileMeta.Size != 0 {
		t.Errorf("Expected empty file meta size 0, got %d", emptyFileMeta.Size)
	}

	err = spacePrimitives.DeleteFile("empty.txt")
	if err != nil {
		t.Fatalf("Failed to delete empty file: %v", err)
	}
}

func testUnicodeContent(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test files with Unicode characters
	unicodeContent := []byte("Hello 世界! 🌍 Здравствуй мир!")
	_, err := spacePrimitives.WriteFile("unicode.txt", unicodeContent, nil)
	if err != nil {
		t.Fatalf("Failed to write unicode file: %v", err)
	}

	unicodeData, _, err := spacePrimitives.ReadFile("unicode.txt")
	if err != nil {
		t.Fatalf("Failed to read unicode file: %v", err)
	}

	if !bytes.Equal(unicodeData, unicodeContent) {
		t.Errorf("Unicode content doesn't match: expected %s, got %s", unicodeContent, unicodeData)
	}

	err = spacePrimitives.DeleteFile("unicode.txt")
	if err != nil {
		t.Fatalf("Failed to delete unicode file: %v", err)
	}
}

func testSpecialFileNames(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test file names with various special characters
	specialNames := []string{
		"file with spaces.txt",
		"file-with-hyphens.txt",
		"file_with_underscores.txt",
		"file.with.dots.txt",
		"UPPERCASE.TXT",
		"123numeric.txt",
		"émojis🚀file.txt",
	}

	for _, fileName := range specialNames {
		content := []byte("Content of " + fileName)
		_, err := spacePrimitives.WriteFile(fileName, content, nil)
		if err != nil {
			t.Fatalf("Failed to write file %s: %v", fileName, err)
		}

		fileData, _, err := spacePrimitives.ReadFile(fileName)
		if err != nil {
			t.Fatalf("Failed to read file %s: %v", fileName, err)
		}

		expectedContent := "Content of " + fileName
		if string(fileData) != expectedContent {
			t.Errorf("Content mismatch for %s: expected %s, got %s", fileName, expectedContent, string(fileData))
		}
	}

	// Verify all special files are in the list
	allFiles, err := spacePrimitives.FetchFileList()
	if err != nil {
		t.Fatalf("Failed to fetch file list: %v", err)
	}

	for _, fileName := range specialNames {
		found := false
		for _, f := range allFiles {
			if f.Name == fileName {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("File %s should be in the file list", fileName)
		}
	}

	// Clean up special files
	for _, fileName := range specialNames {
		err := spacePrimitives.DeleteFile(fileName)
		if err != nil {
			t.Fatalf("Failed to delete file %s: %v", fileName, err)
		}
	}
}

func testErrorHandling(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test error cases
	_, _, err := spacePrimitives.ReadFile("nonexistent.txt")
	if err != ErrNotFound {
		t.Errorf("Expected ErrNotFound for non-existent file, got: %v", err)
	}

	err = spacePrimitives.DeleteFile("nonexistent.txt")
	if err != ErrNotFound {
		t.Errorf("Expected ErrNotFound when deleting non-existent file, got: %v", err)
	}

	_, err = spacePrimitives.GetFileMeta("nonexistent.txt", false)
	if err != ErrNotFound {
		t.Errorf("Expected ErrNotFound for non-existent file meta, got: %v", err)
	}
}

func testLargeFiles(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test large file content
	largeContent := make([]byte, 5*1024*1024) // 5MB
	for i := 0; i < len(largeContent); i++ {
		largeContent[i] = byte(i % 256)
	}

	_, err := spacePrimitives.WriteFile("large.bin", largeContent, nil)
	if err != nil {
		t.Fatalf("Failed to write large file: %v", err)
	}

	largeData, largeMeta, err := spacePrimitives.ReadFile("large.bin")
	if err != nil {
		t.Fatalf("Failed to read large file: %v", err)
	}

	if len(largeData) != len(largeContent) {
		t.Errorf("Large file size mismatch: expected %d, got %d", len(largeContent), len(largeData))
	}

	if largeMeta.Size != int64(len(largeContent)) {
		t.Errorf("Large file meta size mismatch: expected %d, got %d", len(largeContent), largeMeta.Size)
	}

	// Verify content integrity (check first 1000 bytes)
	checkSize := 1000
	if len(largeContent) < checkSize {
		checkSize = len(largeContent)
	}

	for i := 0; i < checkSize; i++ {
		if largeData[i] != largeContent[i] {
			t.Errorf("Large file content mismatch at index %d: expected %d, got %d", i, largeContent[i], largeData[i])
			break
		}
	}

	err = spacePrimitives.DeleteFile("large.bin")
	if err != nil {
		t.Fatalf("Failed to delete large file: %v", err)
	}
}

func testMetadataPreservation(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test metadata preservation
	testContent := []byte("Hello meta!")
	customMeta := &FileMeta{
		Name:         "meta-test.txt",
		Perm:         "rw",
		Created:      1000000,
		ContentType:  "text/plain",
		LastModified: 2000000,
		Size:         int64(len(testContent)),
	}

	_, err := spacePrimitives.WriteFile("meta-test.txt", testContent, customMeta)
	if err != nil {
		t.Fatalf("Failed to write file with custom meta: %v", err)
	}

	_, metaFile, err := spacePrimitives.ReadFile("meta-test.txt")
	if err != nil {
		t.Fatalf("Failed to read file with meta: %v", err)
	}

	// Check that some metadata is preserved (implementations may handle timestamps differently)
	if metaFile.LastModified <= 0 {
		t.Error("LastModified timestamp should be set")
	}

	if metaFile.Name != "meta-test.txt" {
		t.Errorf("Expected name 'meta-test.txt', got '%s'", metaFile.Name)
	}

	if metaFile.Size != int64(len(testContent)) {
		t.Errorf("Expected size %d, got %d", len(testContent), metaFile.Size)
	}

	err = spacePrimitives.DeleteFile("meta-test.txt")
	if err != nil {
		t.Fatalf("Failed to delete meta test file: %v", err)
	}
}
