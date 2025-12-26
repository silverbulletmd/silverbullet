package server

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestInitAuthConcurrency verifies that InitAuth can be called concurrently
// without race conditions, using sync.Once for thread-safe lazy initialization
func TestInitAuthConcurrency(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a basic auth config
	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  60,
		LockoutLimit: 5,
	}

	spaceConfig := &SpaceConfig{
		Auth:            authOptions,
		SpaceFolderPath: tmpDir,
		Authorize: func(username, password string) bool {
			return username == "testuser" && password == "testpass"
		},
	}

	// Call InitAuth concurrently from multiple goroutines
	const numGoroutines = 100
	var wg sync.WaitGroup
	errors := make(chan error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := spaceConfig.InitAuth(); err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("InitAuth failed: %v", err)
	}

	// Verify initialization happened exactly once
	assert.NotNil(t, spaceConfig.JwtIssuer, "JwtIssuer should be initialized")
	assert.NotNil(t, spaceConfig.LockoutTimer, "LockoutTimer should be initialized")

	// Verify the auth file was created
	authFilePath := filepath.Join(tmpDir, ".silverbullet.auth.json")
	_, err := os.Stat(authFilePath)
	assert.NoError(t, err, "Auth file should exist")
}

// TestInitAuthIdempotent verifies that multiple calls to InitAuth
// return the same result without reinitializing
func TestInitAuthIdempotent(t *testing.T) {
	tmpDir := t.TempDir()

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  60,
		LockoutLimit: 5,
	}

	spaceConfig := &SpaceConfig{
		Auth:            authOptions,
		SpaceFolderPath: tmpDir,
		Authorize: func(username, password string) bool {
			return username == "testuser" && password == "testpass"
		},
	}

	// First call
	err1 := spaceConfig.InitAuth()
	assert.NoError(t, err1)
	issuer1 := spaceConfig.JwtIssuer
	timer1 := spaceConfig.LockoutTimer

	// Second call should return same objects (not reinitialize)
	err2 := spaceConfig.InitAuth()
	assert.NoError(t, err2)
	issuer2 := spaceConfig.JwtIssuer
	timer2 := spaceConfig.LockoutTimer

	// Verify same instances (pointer equality)
	assert.Same(t, issuer1, issuer2, "JwtIssuer should be same instance")
	assert.Same(t, timer1, timer2, "LockoutTimer should be same instance")
}

// TestInitAuthPreservesError verifies that if initialization fails,
// the error is preserved and returned on subsequent calls
func TestInitAuthPreservesError(t *testing.T) {
	// Use an invalid path to force an error
	spaceConfig := &SpaceConfig{
		Auth:            &AuthOptions{User: "test", Pass: "test"},
		SpaceFolderPath: "/invalid/path/that/does/not/exist/and/cannot/be/created",
		Authorize: func(username, password string) bool {
			return true
		},
	}

	// First call should fail
	err1 := spaceConfig.InitAuth()
	assert.Error(t, err1, "InitAuth should fail with invalid path")

	// Second call should return the same error
	err2 := spaceConfig.InitAuth()
	assert.Error(t, err2, "InitAuth should still return error")
	assert.Equal(t, err1, err2, "Should return same error instance")

	// JwtIssuer should remain nil
	assert.Nil(t, spaceConfig.JwtIssuer, "JwtIssuer should be nil after failed init")
}
