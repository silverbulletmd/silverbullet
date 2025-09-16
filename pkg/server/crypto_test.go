package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateAuthenticator_NewFile(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth, err := CreateAuthenticator(authFile, authOptions)
	assert.NoError(t, err, "Should create new authenticator without error")
	assert.NotNil(t, auth, "Authenticator should not be nil")
	assert.NotEmpty(t, auth.SecretKey, "Secret key should be generated")
	assert.NotEmpty(t, auth.AuthHash, "Auth hash should be generated")

	// Verify file was created
	_, err = os.Stat(authFile)
	assert.False(t, os.IsNotExist(err), "Auth file should be created")
}

func TestCreateAuthenticator_ExistingFile(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	// Create initial authenticator
	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth1, err := CreateAuthenticator(authFile, authOptions)
	require.NoError(t, err)
	originalKey := auth1.SecretKey

	// Load from existing file with same options
	auth2, err := CreateAuthenticator(authFile, authOptions)
	assert.NoError(t, err, "Should load existing authenticator without error")
	assert.Equal(t, originalKey, auth2.SecretKey, "Secret key should remain the same")
}

func TestCreateAuthenticator_AuthOptionsChanged(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	// Create initial authenticator
	authOptions1 := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth1, err := CreateAuthenticator(authFile, authOptions1)
	require.NoError(t, err)
	originalKey := auth1.SecretKey

	// Load with different auth options
	authOptions2 := &AuthOptions{
		User:         "testuser",
		Pass:         "newpass", // Changed password
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth2, err := CreateAuthenticator(authFile, authOptions2)
	assert.NoError(t, err, "Should load authenticator with changed options")
	assert.NotEqual(t, originalKey, auth2.SecretKey, "Secret key should change when auth options change")
}

func TestAuthenticator_CreateJWT(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth, err := CreateAuthenticator(authFile, authOptions)
	require.NoError(t, err)

	payload := map[string]any{
		"user": "testuser",
		"role": "admin",
	}

	token, err := auth.CreateJWT(payload)
	assert.NoError(t, err, "Should create JWT without error")
	assert.NotEmpty(t, token, "Token should not be empty")

	// Verify token structure (should have 3 parts separated by dots)
	parts := len([]rune(token))
	assert.Greater(t, parts, 0, "Token should not be empty")
}

func TestAuthenticator_CreateJWT_WithExpiry(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth, err := CreateAuthenticator(authFile, authOptions)
	require.NoError(t, err)

	payload := map[string]any{
		"user": "testuser",
	}

	token, err := auth.CreateJWT(payload, 3600) // 1 hour expiry
	assert.NoError(t, err, "Should create JWT with expiry without error")
	assert.NotEmpty(t, token, "Token should not be empty")

	// Verify the token and check expiry
	claims, err := auth.VerifyAndDecodeJWT(token)
	assert.NoError(t, err, "Should verify token")

	exp, ok := claims["exp"]
	assert.True(t, ok, "Token should have expiry claim")
	assert.NotNil(t, exp, "Expiry should not be nil")
}

func TestAuthenticator_VerifyAndDecodeJWT(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth, err := CreateAuthenticator(authFile, authOptions)
	require.NoError(t, err)

	payload := map[string]any{
		"user": "testuser",
		"role": "admin",
		"id":   123,
	}

	token, err := auth.CreateJWT(payload)
	require.NoError(t, err)

	// Verify and decode the token
	claims, err := auth.VerifyAndDecodeJWT(token)
	assert.NoError(t, err, "Should verify and decode JWT without error")
	assert.Equal(t, "testuser", claims["user"], "Should preserve user claim")
	assert.Equal(t, "admin", claims["role"], "Should preserve role claim")
	assert.Equal(t, float64(123), claims["id"], "Should preserve id claim")
}

func TestAuthenticator_VerifyAndDecodeJWT_InvalidToken(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth, err := CreateAuthenticator(authFile, authOptions)
	require.NoError(t, err)

	// Test invalid token
	_, err = auth.VerifyAndDecodeJWT("invalid.token.here")
	assert.Error(t, err, "Should return error for invalid token")

	// Test empty token
	_, err = auth.VerifyAndDecodeJWT("")
	assert.Error(t, err, "Should return error for empty token")
}

func TestAuthenticator_VerifyAndDecodeJWT_ExpiredToken(t *testing.T) {
	tmpDir := t.TempDir()
	authFile := filepath.Join(tmpDir, "auth.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	auth, err := CreateAuthenticator(authFile, authOptions)
	require.NoError(t, err)

	payload := map[string]any{
		"user": "testuser",
	}

	// Create token with 1 second expiry
	token, err := auth.CreateJWT(payload, 1)
	require.NoError(t, err)

	// Wait for token to expire
	time.Sleep(2 * time.Second)

	// Try to verify expired token
	_, err = auth.VerifyAndDecodeJWT(token)
	assert.Error(t, err, "Should return error for expired token")
}

func TestAuthenticator_VerifyAndDecodeJWT_WrongKey(t *testing.T) {
	tmpDir := t.TempDir()
	authFile1 := filepath.Join(tmpDir, "auth1.json")
	authFile2 := filepath.Join(tmpDir, "auth2.json")

	authOptions := &AuthOptions{
		User:         "testuser",
		Pass:         "testpass",
		LockoutTime:  300,
		LockoutLimit: 5,
	}

	// Create two different authenticators (different keys)
	auth1, err := CreateAuthenticator(authFile1, authOptions)
	require.NoError(t, err)

	auth2, err := CreateAuthenticator(authFile2, authOptions)
	require.NoError(t, err)

	payload := map[string]any{
		"user": "testuser",
	}

	// Create token with first authenticator
	token, err := auth1.CreateJWT(payload)
	require.NoError(t, err)

	// Try to verify with second authenticator (different key)
	_, err = auth2.VerifyAndDecodeJWT(token)
	assert.Error(t, err, "Should return error when verifying token with wrong key")
}
