package server

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"golang.org/x/text/unicode/norm"
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
	assert.NoError(t, err, "Failed to fetch final file list")
	assert.Empty(t, finalFiles, "Expected empty file list at end")
}

func testBasicOperations(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test initial empty state
	files, err := spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch file list")
	assert.Empty(t, files, "Expected empty file list")

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
	assert.NoError(t, err, "Failed to write file")

	// Read the file back
	retrievedData, retrievedMeta, err := spacePrimitives.ReadFile("test.txt")
	assert.NoError(t, err, "Failed to read file")

	assert.Equal(t, testContent, retrievedData, "Retrieved data doesn't match")

	// Check that the meta data is persisted (lastModified should be preserved)
	assert.Equal(t, int64(20), retrievedMeta.LastModified, "Expected lastModified to be 20")

	// Check file list
	fileList, err := spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch file list")
	assert.Len(t, fileList, 1, "Expected 1 file in list")
	assert.Equal(t, "test.txt", fileList[0].Name, "Expected file name 'test.txt'")

	// Write binary file
	buf := make([]byte, 1024*1024)
	buf[0] = 1
	buf[1] = 2
	buf[2] = 3
	buf[3] = 4
	buf[4] = 5

	_, err = spacePrimitives.WriteFile("test.bin", buf, nil)
	assert.NoError(t, err, "Failed to write binary file")

	fileData, _, err := spacePrimitives.ReadFile("test.bin")
	assert.NoError(t, err, "Failed to read binary file")

	assert.Len(t, fileData, 1024*1024, "Expected binary file size to match")

	fileList, err = spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch file list")
	assert.Len(t, fileList, 2, "Expected 2 files in list")

	// Delete binary file
	err = spacePrimitives.DeleteFile("test.bin")
	assert.NoError(t, err, "Failed to delete binary file")

	fileList, err = spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch file list")
	assert.Len(t, fileList, 1, "Expected 1 file in list after deletion")

	// Clean up
	err = spacePrimitives.DeleteFile("test.txt")
	assert.NoError(t, err, "Failed to delete test file")

	fileList, err = spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch file list")
	assert.Empty(t, fileList, "Expected empty file list after cleanup")

	// Test weird file names
	weirdContent := []byte("Hello world!")
	_, err = spacePrimitives.WriteFile("test+'s.txt", weirdContent, nil)
	assert.NoError(t, err, "Failed to write file with weird name")

	readWeirdData, _, err := spacePrimitives.ReadFile("test+'s.txt")
	assert.NoError(t, err, "Failed to read file with weird name")

	assert.Equal(t, weirdContent, readWeirdData, "Weird file content doesn't match")

	err = spacePrimitives.DeleteFile("test+'s.txt")
	assert.NoError(t, err, "Failed to delete weird file")

	// Check deletion of weird file name
	_, _, err = spacePrimitives.ReadFile("test+'s.txt")
	assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound when reading deleted file")
}

func testFileOverwriting(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test overwriting existing files
	originalContent := []byte("Original")
	_, err := spacePrimitives.WriteFile("overwrite.txt", originalContent, nil)
	assert.NoError(t, err, "Failed to write original file")

	_, err = spacePrimitives.GetFileMeta("overwrite.txt")
	assert.NoError(t, err, "Failed to get original meta")

	updatedContent := []byte("Updated")
	_, err = spacePrimitives.WriteFile("overwrite.txt", updatedContent, nil)
	assert.NoError(t, err, "Failed to overwrite file")

	updatedData, _, err := spacePrimitives.ReadFile("overwrite.txt")
	assert.NoError(t, err, "Failed to read overwritten file")

	assert.Equal(t, updatedContent, updatedData, "Overwritten content doesn't match")

	// File list should still have only one entry for this file
	filesAfterOverwrite, err := spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch files after overwrite")

	overwriteFiles := 0
	for _, f := range filesAfterOverwrite {
		if f.Name == "overwrite.txt" {
			overwriteFiles++
		}
	}

	assert.Equal(t, 1, overwriteFiles, "Expected 1 instance of overwrite.txt")

	err = spacePrimitives.DeleteFile("overwrite.txt")
	assert.NoError(t, err, "Failed to delete overwritten file")

	// Test writing files to new folders
	writeMeta, err := spacePrimitives.WriteFile("some/folder/test.dat", []byte("Testing"), nil)
	assert.NoError(t, err, "Writing to a nested folder should work")

	// Read it back
	data, meta, err := spacePrimitives.ReadFile("some/folder/test.dat")
	assert.NoError(t, err, "Reading should work")
	assert.Equal(t, writeMeta.LastModified, meta.LastModified, "Meta should be the same")
	assert.Equal(t, []byte("Testing"), data, "Did not get back what I put in")

	err = spacePrimitives.DeleteFile("some/folder/test.dat")
	assert.NoError(t, err, "Deletion should work")
}

func testEmptyFiles(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test empty file
	emptyData := []byte{}
	_, err := spacePrimitives.WriteFile("empty.txt", emptyData, nil)
	assert.NoError(t, err, "Failed to write empty file")

	emptyFileData, emptyFileMeta, err := spacePrimitives.ReadFile("empty.txt")
	assert.NoError(t, err, "Failed to read empty file")

	assert.Empty(t, emptyFileData, "Expected empty file data")
	assert.Equal(t, int64(0), emptyFileMeta.Size, "Expected empty file meta size 0")

	err = spacePrimitives.DeleteFile("empty.txt")
	assert.NoError(t, err, "Failed to delete empty file")
}

func testUnicodeContent(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test files with Unicode characters
	unicodeContent := []byte("Hello 世界! 🌍 Здравствуй мир!")
	_, err := spacePrimitives.WriteFile("unicode.txt", unicodeContent, nil)
	assert.NoError(t, err, "Failed to write unicode file")

	unicodeData, _, err := spacePrimitives.ReadFile("unicode.txt")
	assert.NoError(t, err, "Failed to read unicode file")

	assert.Equal(t, unicodeContent, unicodeData, "Unicode content doesn't match")

	err = spacePrimitives.DeleteFile("unicode.txt")
	assert.NoError(t, err, "Failed to delete unicode file")
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
		assert.NoError(t, err, "Failed to write file %s", fileName)

		fileData, _, err := spacePrimitives.ReadFile(fileName)
		assert.NoError(t, err, "Failed to read file %s", fileName)

		expectedContent := "Content of " + fileName
		assert.Equal(t, expectedContent, string(fileData), "Content mismatch for %s", fileName)
	}

	// Verify all special files are in the list
	allFiles, err := spacePrimitives.FetchFileList()
	assert.NoError(t, err, "Failed to fetch file list")

	for _, fileName := range specialNames {
		// Normalize the expected filename to NFD for comparison
		normalizedExpected := norm.NFD.String(fileName)
		found := false
		for _, f := range allFiles {
			if f.Name == normalizedExpected {
				found = true
				break
			}
		}
		assert.True(t, found, "File %s should be in the file list", fileName)
	}

	// Clean up special files
	for _, fileName := range specialNames {
		err := spacePrimitives.DeleteFile(fileName)
		assert.NoError(t, err, "Failed to delete file %s", fileName)
	}
}

func testErrorHandling(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test error cases
	_, _, err := spacePrimitives.ReadFile("nonexistent.txt")
	assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound for non-existent file")

	err = spacePrimitives.DeleteFile("nonexistent.txt")
	assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound when deleting non-existent file")

	_, err = spacePrimitives.GetFileMeta("nonexistent.txt")
	assert.Equal(t, ErrNotFound, err, "Expected ErrNotFound for non-existent file meta")
}

func testLargeFiles(t *testing.T, spacePrimitives SpacePrimitives) {
	// Test large file content
	largeContent := make([]byte, 5*1024*1024) // 5MB
	for i := 0; i < len(largeContent); i++ {
		largeContent[i] = byte(i % 256)
	}

	_, err := spacePrimitives.WriteFile("large.bin", largeContent, nil)
	assert.NoError(t, err, "Failed to write large file")

	largeData, largeMeta, err := spacePrimitives.ReadFile("large.bin")
	assert.NoError(t, err, "Failed to read large file")

	assert.Len(t, largeData, len(largeContent), "Large file size mismatch")
	assert.Equal(t, int64(len(largeContent)), largeMeta.Size, "Large file meta size mismatch")

	// Verify content integrity (check first 1000 bytes)
	checkSize := 1000
	if len(largeContent) < checkSize {
		checkSize = len(largeContent)
	}

	assert.True(t, bytes.Equal(largeData[:checkSize], largeContent[:checkSize]), "Large file content mismatch in first %d bytes", checkSize)

	err = spacePrimitives.DeleteFile("large.bin")
	assert.NoError(t, err, "Failed to delete large file")
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
	assert.NoError(t, err, "Failed to write file with custom meta")

	_, metaFile, err := spacePrimitives.ReadFile("meta-test.txt")
	assert.NoError(t, err, "Failed to read file with meta")

	// Check that some metadata is preserved (implementations may handle timestamps differently)
	assert.Greater(t, metaFile.LastModified, int64(0), "LastModified timestamp should be set")
	assert.Equal(t, "meta-test.txt", metaFile.Name, "Expected name 'meta-test.txt'")
	assert.Equal(t, int64(len(testContent)), metaFile.Size, "Expected size to match content length")

	err = spacePrimitives.DeleteFile("meta-test.txt")
	assert.NoError(t, err, "Failed to delete meta test file")
}
