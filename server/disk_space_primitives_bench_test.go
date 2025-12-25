package server

import (
	"fmt"
	"os"
	"testing"
)

// BenchmarkWriteFile measures the performance of WriteFile operations
func BenchmarkWriteFile(b *testing.B) {
	// Create temporary directory
	tmpDir := b.TempDir()

	// Create disk space primitives
	primitives, err := NewDiskSpacePrimitives(tmpDir, "")
	if err != nil {
		b.Fatalf("Failed to create disk space primitives: %v", err)
	}

	// Test data
	testData := []byte("This is test content for benchmarking WriteFile performance")

	b.ResetTimer()

	// Run WriteFile b.N times
	for i := 0; i < b.N; i++ {
		filename := fmt.Sprintf("bench_file_%d.md", i)
		_, err := primitives.WriteFile(filename, testData, nil)
		if err != nil {
			b.Fatalf("WriteFile failed: %v", err)
		}
	}
}

// BenchmarkWriteFileWithMeta measures performance when metadata is provided
func BenchmarkWriteFileWithMeta(b *testing.B) {
	tmpDir := b.TempDir()

	primitives, err := NewDiskSpacePrimitives(tmpDir, "")
	if err != nil {
		b.Fatalf("Failed to create disk space primitives: %v", err)
	}

	testData := []byte("This is test content for benchmarking WriteFile performance")
	meta := &FileMeta{
		LastModified: 1234567890000,
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		filename := fmt.Sprintf("bench_file_%d.md", i)
		_, err := primitives.WriteFile(filename, testData, meta)
		if err != nil {
			b.Fatalf("WriteFile failed: %v", err)
		}
	}
}

// BenchmarkWriteFileLarge measures performance with larger files
func BenchmarkWriteFileLarge(b *testing.B) {
	tmpDir := b.TempDir()

	primitives, err := NewDiskSpacePrimitives(tmpDir, "")
	if err != nil {
		b.Fatalf("Failed to create disk space primitives: %v", err)
	}

	// 100KB test data
	testData := make([]byte, 100*1024)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		filename := fmt.Sprintf("bench_file_%d.md", i)
		_, err := primitives.WriteFile(filename, testData, nil)
		if err != nil {
			b.Fatalf("WriteFile failed: %v", err)
		}
	}
}

// BenchmarkWriteAndReadCycle measures the full write/read cycle
func BenchmarkWriteAndReadCycle(b *testing.B) {
	tmpDir := b.TempDir()

	primitives, err := NewDiskSpacePrimitives(tmpDir, "")
	if err != nil {
		b.Fatalf("Failed to create disk space primitives: %v", err)
	}

	testData := []byte("Test content")

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		filename := fmt.Sprintf("bench_file_%d.md", i)

		// Write
		_, err := primitives.WriteFile(filename, testData, nil)
		if err != nil {
			b.Fatalf("WriteFile failed: %v", err)
		}

		// Read back
		_, _, err = primitives.ReadFile(filename)
		if err != nil {
			b.Fatalf("ReadFile failed: %v", err)
		}
	}
}

// BenchmarkGetFileMeta_AfterWrite shows the cost of the syscall we're eliminating
func BenchmarkGetFileMeta_AfterWrite(b *testing.B) {
	tmpDir := b.TempDir()

	// Create a test file
	testFile := tmpDir + "/test.md"
	err := os.WriteFile(testFile, []byte("test"), 0644)
	if err != nil {
		b.Fatalf("Failed to create test file: %v", err)
	}

	primitives, err := NewDiskSpacePrimitives(tmpDir, "")
	if err != nil {
		b.Fatalf("Failed to create disk space primitives: %v", err)
	}

	b.ResetTimer()

	// Measure just the GetFileMeta call (the syscall we're avoiding)
	for i := 0; i < b.N; i++ {
		_, err := primitives.GetFileMeta("test.md")
		if err != nil {
			b.Fatalf("GetFileMeta failed: %v", err)
		}
	}
}
