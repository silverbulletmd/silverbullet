package tunnel

import (
	"bytes"
	"testing"
)

// TestGzipRoundTrip tests that compressing and then decompressing returns the original data
func TestGzipRoundTrip(t *testing.T) {
	testCases := []struct {
		name  string
		input []byte
	}{
		{
			name:  "Empty string",
			input: []byte(""),
		},
		{
			name:  "Small string",
			input: []byte("hello world"),
		},
		{
			name:  "Medium string",
			input: []byte("The quick brown fox jumps over the lazy dog"),
		},
		{
			name:  "Repeated pattern",
			input: bytes.Repeat([]byte("abc"), 321),
		},
		{
			name:  "Binary data",
			input: []byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Compress
			compressed, err := GzipCompress(tc.input)
			if err != nil {
				t.Fatalf("compression failed: %v", err)
			}

			// Decompress
			decompressed, err := GzipDecompress(compressed)
			if err != nil {
				t.Fatalf("decompression failed: %v", err)
			}

			// Verify round trip
			if !bytes.Equal(tc.input, decompressed) {
				t.Errorf("round trip failed: got %v, want %v", decompressed, tc.input)
			}
		})
	}
}

// TestGzipCompress tests specific compression scenarios
func TestGzipCompress(t *testing.T) {
	// Test with empty data
	compressed, err := GzipCompress([]byte{})
	if err != nil {
		t.Fatalf("failed to compress empty data: %v", err)
	}
	if len(compressed) == 0 {
		t.Error("compressed empty data resulted in empty output, expected some gzip header")
	}

	// Test with sample data
	data := []byte("sample data for compression")
	compressed, err = GzipCompress(data)
	if err != nil {
		t.Fatalf("failed to compress sample data: %v", err)
	}

	// Check that compressed data is different from input
	if bytes.Equal(data, compressed) {
		t.Error("compressed data is identical to input, expected different binary content")
	}
}

// TestGzipDecompress tests specific decompression scenarios
func TestGzipDecompress(t *testing.T) {
	// Test with empty data
	decompressed, err := GzipDecompress([]byte{})
	if err != nil {
		t.Errorf("failed to decompress empty data: %v", err)
	}
	if len(decompressed) != 0 {
		t.Errorf("decompressing empty data should return empty result, got %v", decompressed)
	}

	// Test with invalid data
	_, err = GzipDecompress([]byte("not gzip compressed data"))
	if err == nil {
		t.Error("expected error when decompressing invalid data, got nil")
	}

	// Test valid case
	data := []byte("test compression and decompression")
	compressed, err := GzipCompress(data)
	if err != nil {
		t.Fatalf("compression failed in decompress test: %v", err)
	}

	decompressed, err = GzipDecompress(compressed)
	if err != nil {
		t.Fatalf("failed to decompress valid data: %v", err)
	}
	if !bytes.Equal(data, decompressed) {
		t.Errorf("decompressed data doesn't match original: got %v, want %v", decompressed, data)
	}
}
