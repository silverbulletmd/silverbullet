package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/unicode/norm"
)

// TestUnicodeNormalization verifies that file paths with Unicode characters
// are handled consistently across different normalization forms (NFC vs NFD)
func TestUnicodeNormalization(t *testing.T) {
	tmpDir := t.TempDir()

	dsp, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	// Test with "Ä" (A with diaeresis)
	// NFC form (composed): U+00C4
	// NFD form (decomposed): U+0041 U+0308
	fileNameNFC := "\u00C4.md" // Ä in NFC form (single codepoint)
	fileNameNFD := "A\u0308.md" // Ä in NFD form (base + combining char)

	// Verify they look the same but have different byte representations
	assert.NotEqual(t, fileNameNFC, fileNameNFD, "NFC and NFD should be different strings")
	// Both should normalize to the same NFD form
	assert.Equal(t, norm.NFD.String(fileNameNFC), norm.NFD.String(fileNameNFD), "Should normalize to same form")

	content := []byte("Test content with Unicode filename")

	expectedNormalizedName := norm.NFD.String(fileNameNFC) // "A\u0308.md"

	// Write file using NFC form
	meta, err := dsp.WriteFile(fileNameNFC, content, nil)
	require.NoError(t, err)
	assert.Equal(t, expectedNormalizedName, meta.Name)

	// Read file using NFD form (should find the same file)
	readData, readMeta, err := dsp.ReadFile(fileNameNFD)
	require.NoError(t, err)
	assert.Equal(t, content, readData)
	assert.Equal(t, expectedNormalizedName, readMeta.Name)

	// Read file using NFC form (should also find the same file)
	readData2, readMeta2, err := dsp.ReadFile(fileNameNFC)
	require.NoError(t, err)
	assert.Equal(t, content, readData2)
	assert.Equal(t, expectedNormalizedName, readMeta2.Name)

	// Get file meta using both forms
	metaNFC, err := dsp.GetFileMeta(fileNameNFC)
	require.NoError(t, err)

	metaNFD, err := dsp.GetFileMeta(fileNameNFD)
	require.NoError(t, err)

	// Both should return the same normalized name
	assert.Equal(t, metaNFC.Name, metaNFD.Name)
	assert.Equal(t, expectedNormalizedName, metaNFC.Name)
}

// TestUnicodeNormalizationFileList verifies that file listing returns
// normalized paths for files with Unicode characters
func TestUnicodeNormalizationFileList(t *testing.T) {
	tmpDir := t.TempDir()

	dsp, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	// Create files with various Unicode characters
	testFiles := []string{
		"café.md",                   // é in NFC
		"Äpfel.md",                  // Ä in NFC
		"日本語.md",                    // Japanese
		"Příliš žluťoučký kůň.md",   // Czech with diacritics
		norm.NFD.String("résumé.md"), // NFD form
	}

	for _, filename := range testFiles {
		_, err := dsp.WriteFile(filename, []byte("content"), nil)
		require.NoError(t, err, "Failed to write file: %s", filename)
	}

	// Fetch file list
	files, err := dsp.FetchFileList()
	require.NoError(t, err)

	// All file names should be in NFD form
	for _, file := range files {
		normalized := norm.NFD.String(file.Name)
		assert.Equal(t, normalized, file.Name, "File name should be NFD normalized: %s", file.Name)
	}

	// Should be able to find all files
	assert.Len(t, files, len(testFiles))
}

// TestUnicodeNormalizationDelete verifies that files with Unicode characters
// can be deleted using either normalization form
func TestUnicodeNormalizationDelete(t *testing.T) {
	tmpDir := t.TempDir()

	dsp, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	fileNameNFC := "Ö.md"
	fileNameNFD := norm.NFD.String(fileNameNFC)

	// Create file
	_, err = dsp.WriteFile(fileNameNFC, []byte("content"), nil)
	require.NoError(t, err)

	// Verify file exists
	_, _, err = dsp.ReadFile(fileNameNFC)
	require.NoError(t, err)

	// Delete using NFD form
	err = dsp.DeleteFile(fileNameNFD)
	require.NoError(t, err)

	// Verify file is gone (using NFC form)
	_, _, err = dsp.ReadFile(fileNameNFC)
	assert.Equal(t, ErrNotFound, err)
}

// TestUnicodeNormalizationSubdirectory verifies Unicode normalization
// works correctly for files in subdirectories
func TestUnicodeNormalizationSubdirectory(t *testing.T) {
	tmpDir := t.TempDir()

	dsp, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	// Directory and file name both with Unicode
	dirNameNFC := "Földer"
	fileNameNFC := "Äfile.md"
	fullPathNFC := dirNameNFC + "/" + fileNameNFC

	// NFD forms
	fullPathNFD := norm.NFD.String(fullPathNFC)

	content := []byte("Unicode in subdirectory")

	// Write using NFC
	_, err = dsp.WriteFile(fullPathNFC, content, nil)
	require.NoError(t, err)

	// Read using NFD
	readData, _, err := dsp.ReadFile(fullPathNFD)
	require.NoError(t, err)
	assert.Equal(t, content, readData)

	// List files should show normalized path
	files, err := dsp.FetchFileList()
	require.NoError(t, err)
	require.Len(t, files, 1)
	assert.Equal(t, norm.NFD.String(fullPathNFC), files[0].Name)
}

// TestUnicodeNormalizationPathTraversal ensures normalization doesn't
// interfere with path traversal security checks
func TestUnicodeNormalizationPathTraversal(t *testing.T) {
	tmpDir := t.TempDir()

	dsp, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	// Try to escape with Unicode in the path
	maliciousPath := "../Ä.md"

	_, err = dsp.WriteFile(maliciousPath, []byte("content"), nil)
	assert.Equal(t, ErrPathOutsideRoot, err, "Should reject path traversal")

	_, _, err = dsp.ReadFile(maliciousPath)
	assert.Equal(t, ErrPathOutsideRoot, err, "Should reject path traversal")
}

// TestNormalizePathFunction tests the normalizePath helper function directly
func TestNormalizePathFunction(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "NFC to NFD - Ä",
			input:    "\u00C4",           // NFC: Ä as single character
			expected: "A\u0308",          // NFD: A + combining diaeresis
		},
		{
			name:     "Already NFD",
			input:    "A\u0308",
			expected: "A\u0308",
		},
		{
			name:     "ASCII unchanged",
			input:    "test.md",
			expected: "test.md",
		},
		{
			name:     "Mixed path",
			input:    "folder/café.md",
			expected: norm.NFD.String("folder/café.md"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizePath(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestUnicodeNormalizationRealWorld tests with the specific example from issue #1213
func TestUnicodeNormalizationRealWorld(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a normalized file on disk using the OS directly
	// This simulates what happens on a normalizing file system (macOS APFS)
	nfcName := "\u00C4.md" // NFC form: Ä as single codepoint
	normalizedPath := filepath.Join(tmpDir, norm.NFD.String(nfcName))
	err := os.WriteFile(normalizedPath, []byte("test"), 0644)
	require.NoError(t, err)

	dsp, err := NewDiskSpacePrimitives(tmpDir, "")
	require.NoError(t, err)

	expectedNormalizedName := norm.NFD.String(nfcName) // NFD form: A + combining diaeresis

	// Should be able to read the file using NFC form (what user might type)
	data, meta, err := dsp.ReadFile(nfcName)
	require.NoError(t, err, "Should find file regardless of normalization form")
	assert.Equal(t, []byte("test"), data)
	assert.Equal(t, expectedNormalizedName, meta.Name)

	// Should appear in file list with normalized name
	files, err := dsp.FetchFileList()
	require.NoError(t, err)
	require.Len(t, files, 1)
	assert.Equal(t, expectedNormalizedName, files[0].Name)
}
