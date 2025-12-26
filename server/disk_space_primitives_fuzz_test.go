package server

import (
	"path/filepath"
	"strings"
	"testing"
)

// FuzzSafePath tests safePath for path traversal vulnerabilities
func FuzzSafePath(f *testing.F) {
	// Create a test DiskSpacePrimitives instance
	dsp := &DiskSpacePrimitives{
		rootPath: "/tmp/test",
	}

	// Seed corpus with interesting test cases
	f.Add("test.md")
	f.Add("../test.md")
	f.Add("../../etc/passwd")
	f.Add("./test.md")
	f.Add("foo/bar/test.md")
	f.Add("foo/../test.md")
	f.Add("foo/../../test.md")
	f.Add("/etc/passwd")
	f.Add("")
	f.Add(".")
	f.Add("..")
	f.Add(".....")
	f.Add("foo/./bar")
	f.Add("\\..\\..\\windows\\system32")
	f.Add("Ä.md")
	f.Add("café.md")

	f.Fuzz(func(t *testing.T, path string) {
		result, err := dsp.safePath(path)

		if err != nil {
			// If there's an error, it should be ErrPathOutsideRoot
			if err != ErrPathOutsideRoot {
				t.Errorf("safePath returned unexpected error: %v", err)
			}
			return
		}

		// If no error, the result must be within rootPath
		if !strings.HasPrefix(result, dsp.rootPath) {
			t.Errorf("safePath allowed path traversal: input=%q, result=%q", path, result)
		}

		// The result should be an absolute path
		if !filepath.IsAbs(result) {
			t.Errorf("safePath returned non-absolute path: %q", result)
		}

		// The cleaned result should equal the result (no .. or . components remaining)
		cleaned := filepath.Clean(result)
		if cleaned != result {
			t.Errorf("safePath returned non-clean path: result=%q, cleaned=%q", result, cleaned)
		}
	})
}

// FuzzNormalizePath tests Unicode normalization for security issues
func FuzzNormalizePath(f *testing.F) {
	// Seed with various Unicode forms
	f.Add("test.md")
	f.Add("Ä.md")                      // NFC: U+00C4
	f.Add("A\u0308.md")                // NFD: U+0041 U+0308
	f.Add("café.md")                   // NFC
	f.Add("cafe\u0301.md")             // NFD with combining acute
	f.Add("日本語.md")                    // Japanese
	f.Add("Příliš žluťoučký kůň.md")   // Czech
	f.Add("..ö/..ä/../etc/passwd")     // Path traversal with Unicode
	f.Add("émojis🚀file.txt")
	f.Add("\u202e\u202dtrickery.md")   // Right-to-left override

	f.Fuzz(func(t *testing.T, input string) {
		normalized := normalizePath(input)

		// The normalized form should be stable (idempotent)
		reNormalized := normalizePath(normalized)
		if normalized != reNormalized {
			t.Errorf("normalizePath is not idempotent: input=%q, first=%q, second=%q",
				input, normalized, reNormalized)
		}

		// The normalized form should not introduce new path separators
		inputSepCount := strings.Count(input, "/")
		normalizedSepCount := strings.Count(normalized, "/")
		if normalizedSepCount > inputSepCount {
			t.Errorf("normalizePath introduced path separators: input=%q (%d), normalized=%q (%d)",
				input, inputSepCount, normalized, normalizedSepCount)
		}

		// If the input contained "..", the normalized form should too
		// (we don't want normalization to hide path traversal attempts)
		if strings.Contains(input, "..") {
			if !strings.Contains(normalized, "..") {
				// This might be OK if the Unicode normalization transformed the dots
				// But we should still verify the path is safe
				t.Logf("Note: normalization removed ..: input=%q, normalized=%q", input, normalized)
			}
		}
	})
}

// FuzzFilenameToPath tests the combined safePath + normalizePath logic
func FuzzFilenameToPath(f *testing.F) {
	dsp := &DiskSpacePrimitives{
		rootPath: "/tmp/test",
	}

	// Seed with combined security test cases
	f.Add("test.md")
	f.Add("../../../etc/passwd")
	f.Add("Ä/../etc/passwd")
	f.Add("café/../../etc/passwd")
	f.Add("\u202e\u202d../etc/passwd")
	f.Add("normal/Ä.md")
	f.Add("émojis🚀/../../etc/passwd")

	f.Fuzz(func(t *testing.T, filename string) {
		result, err := dsp.filenameToPath(filename)

		if err != nil {
			// Errors are OK - they prevent bad paths
			if err != ErrPathOutsideRoot {
				t.Errorf("filenameToPath returned unexpected error: %v", err)
			}
			return
		}

		// Result must be within root
		if !strings.HasPrefix(result, dsp.rootPath) {
			t.Errorf("filenameToPath allowed escape: filename=%q, result=%q", filename, result)
		}

		// Result must be absolute
		if !filepath.IsAbs(result) {
			t.Errorf("filenameToPath returned relative path: %q", result)
		}

		// Result must be clean (no .. or . components)
		cleaned := filepath.Clean(result)
		if cleaned != result {
			t.Errorf("filenameToPath returned unclean path: result=%q, cleaned=%q", result, cleaned)
		}
	})
}
