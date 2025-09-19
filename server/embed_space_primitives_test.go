package server

import (
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestFSSpacePrimitivesWithMapFS(t *testing.T) {
	// Test with a MapFS that has embedded files
	mapFS := fstest.MapFS{
		"readme.txt":  &fstest.MapFile{Data: []byte("Hello World")},
		"config.json": &fstest.MapFile{Data: []byte(`{"test": true}`)},
	}

	// Note: t.TempDir() automatically deletes the folder after the tests runs
	fallback, err := NewDiskSpacePrimitives(t.TempDir(), "")
	assert.NoError(t, err, "Failed to create fallback")

	primitives := NewReadOnlyFallthroughSpacePrimitives(mapFS, "", time.Now(), fallback)

	// Test reading embedded files
	data, meta, err := primitives.ReadFile("readme.txt")
	assert.NoError(t, err, "Should read embedded file")
	assert.Equal(t, []byte("Hello World"), data, "Content should match")
	assert.Equal(t, "readme.txt", meta.Name, "Name should match")
	assert.Equal(t, "ro", meta.Perm, "Embedded files should be read-only")

	// Test that writing to embedded file names fails
	_, err = primitives.WriteFile("readme.txt", []byte("new content"), nil)
	assert.Error(t, err, "Should not overwrite embedded files")
	assert.Contains(t, err.Error(), "read-only")

	// Test that deleting embedded files fails
	err = primitives.DeleteFile("config.json")
	assert.Error(t, err, "Should not delete embedded files")
	assert.Contains(t, err.Error(), "read-only")

	// Test writing to non-embedded file names (should work via fallback)
	_, err = primitives.WriteFile("new_file.txt", []byte("fallback content"), nil)
	assert.NoError(t, err, "Should write to fallback for non-embedded files")

	// Test that fallback file can be read back
	data, meta, err = primitives.ReadFile("new_file.txt")
	assert.NoError(t, err, "Should read fallback file")
	assert.Equal(t, []byte("fallback content"), data, "Fallback content should match")
	assert.Equal(t, "new_file.txt", meta.Name, "Fallback file name should match")
}
