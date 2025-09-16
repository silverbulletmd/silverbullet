package server

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Authenticator handles JWT creation and verification
type Authenticator struct {
	path      string
	SecretKey string `json:"secret_key"`
	AuthHash  string `json:"auth_hash"`
}

func CreateAuthenticator(path string, authString string) (*Authenticator, error) {
	// Load from JSON
	jsonBytes, err := os.ReadFile(path)
	// If the file is not found, just start fresh
	if os.IsNotExist(err) {
		auth := &Authenticator{path: path}

		if err := auth.init(authString); err != nil {
			return nil, err
		}
		return auth, nil
	}
	if err != nil {
		return nil, err
	}

	var auth Authenticator
	auth.path = path
	if err := json.Unmarshal(jsonBytes, &auth); err != nil {
		return nil, err
	}
	if err := auth.init(authString); err != nil {
		return nil, err
	}

	return &auth, nil
}

func (j *Authenticator) save() error {
	jsonBytes, err := json.Marshal(j)
	if err != nil {
		return err
	}

	return os.WriteFile(j.path, jsonBytes, 0600)
}

// Init initializes the JWT issuer with an auth string for validation
func (j *Authenticator) init(authString string) error {
	if j.SecretKey == "" {
		fmt.Println("Generating new JWT secret key")
		if err := j.generateNewKey(); err != nil {
			return err
		}
	}

	newAuthHash := j.hashSHA256(authString)
	if j.AuthHash != newAuthHash {
		fmt.Println("Authentication has changed since last run, so invalidating all existing tokens")
		// Generate new key to invalidate all existing tokens
		if err := j.generateNewKey(); err != nil {
			return err
		}
	}

	j.AuthHash = newAuthHash

	return j.save()

}

// generateNewKey creates and stores a new secret key
func (j *Authenticator) generateNewKey() error {
	// Generate 32 bytes (256 bits) of random data for the secret
	secretKey := make([]byte, 32)
	if _, err := rand.Read(secretKey); err != nil {
		return fmt.Errorf("failed to generate secret key: %v", err)
	}

	j.SecretKey = base64.StdEncoding.EncodeToString(secretKey)

	return nil
}

// hashSHA256 creates a SHA256 hash of the input string
func (j *Authenticator) hashSHA256(input string) string {
	hash := sha256.Sum256([]byte(input))
	return hex.EncodeToString(hash[:])
}

// CreateJWT creates a new JWT token with the given payload
func (j *Authenticator) CreateJWT(payload map[string]any, expirySeconds ...int) (string, error) {
	claims := jwt.MapClaims{}

	// Copy payload to claims
	for k, v := range payload {
		claims[k] = v
	}

	// Add expiry if specified
	if len(expirySeconds) > 0 && expirySeconds[0] > 0 {
		claims["exp"] = time.Now().Add(time.Duration(expirySeconds[0]) * time.Second).Unix()
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	key, err := base64.StdEncoding.DecodeString(j.SecretKey)
	if err != nil {
		return "", err
	}
	return token.SignedString(key)
}

// VerifyAndDecodeJWT verifies and decodes a JWT token
func (j *Authenticator) VerifyAndDecodeJWT(tokenString string) (map[string]any, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		// Validate the signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return base64.StdEncoding.DecodeString(j.SecretKey)
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
