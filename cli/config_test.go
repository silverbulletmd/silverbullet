package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	secrets := []string{
		"simple-token",
		"p@ssw0rd!with$pecial&chars",
		"",
		"a",
		"unicode: こんにちは世界",
	}
	for _, secret := range secrets {
		encrypted, err := Encrypt(secret)
		require.NoError(t, err)
		assert.NotEqual(t, secret, encrypted)

		decrypted, err := Decrypt(encrypted)
		require.NoError(t, err)
		assert.Equal(t, secret, decrypted)
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	e1, err := Encrypt("same-input")
	require.NoError(t, err)
	e2, err := Encrypt("same-input")
	require.NoError(t, err)
	assert.NotEqual(t, e1, e2, "different IVs should produce different ciphertexts")
}

func TestDecryptInvalidFormat(t *testing.T) {
	cases := []string{
		"not-valid",
		"only:two",
		"",
	}
	for _, input := range cases {
		_, err := Decrypt(input)
		assert.Error(t, err)
	}
}

func TestDecryptCorruptedData(t *testing.T) {
	encrypted, err := Encrypt("test")
	require.NoError(t, err)

	// Corrupt the ciphertext portion
	_, err = Decrypt(encrypted + "AAAA")
	assert.Error(t, err)
}

func TestConfigSaveLoad(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "config.json")

	cfg := &Config{
		Spaces: []SpaceConfig{
			{
				ID:   "test-id-1",
				Name: "work",
				URL:  "https://work.example.com",
				Auth: AuthConfig{
					Method: "token",
				},
			},
			{
				ID:   "test-id-2",
				Name: "personal",
				URL:  "https://personal.example.com",
				Auth: AuthConfig{
					Method: "none",
				},
			},
		},
	}

	// Use SaveConfig's marshaling logic manually (since SaveConfig writes to a fixed path)
	rawSpaces := make([]json.RawMessage, 0, len(cfg.Spaces))
	for _, s := range cfg.Spaces {
		r, err := marshalSpace(s)
		require.NoError(t, err)
		rawSpaces = append(rawSpaces, r)
	}
	wrapper := struct {
		Spaces []json.RawMessage `json:"spaces"`
	}{Spaces: rawSpaces}
	data, err := json.MarshalIndent(wrapper, "", "  ")
	require.NoError(t, err)
	data = append(data, '\n')
	require.NoError(t, os.WriteFile(cfgPath, data, 0600))

	// Read and parse
	readData, err := os.ReadFile(cfgPath)
	require.NoError(t, err)

	loaded, err := parseConfig(readData)
	require.NoError(t, err)

	assert.Len(t, loaded.Spaces, 2)
	assert.Equal(t, "test-id-1", loaded.Spaces[0].ID)
	assert.Equal(t, "work", loaded.Spaces[0].Name)
	assert.Equal(t, "https://work.example.com", loaded.Spaces[0].URL)
	assert.Equal(t, "token", loaded.Spaces[0].Auth.Method)
	assert.Equal(t, "test-id-2", loaded.Spaces[1].ID)
	assert.Equal(t, "personal", loaded.Spaces[1].Name)
}

func TestPassthroughPreservesUnknownFields(t *testing.T) {
	// Simulate a config file with App-specific fields that Core doesn't model
	input := `{
  "spaces": [
    {
      "id": "abc-123",
      "name": "my-notes",
      "folderPath": "/home/user/notes",
      "preferredPort": 3010,
      "auth": { "method": "none" },
      "sync": { "enabled": true, "remoteUrl": "https://remote.example.com" },
      "lastOpened": 1711526400000,
      "windows": [{ "pagePath": "index", "x": 100, "y": 200, "width": 1200, "height": 800 }],
      "customAppField": "should-survive"
    },
    {
      "id": "def-456",
      "name": "remote-wiki",
      "url": "https://wiki.example.com",
      "auth": { "method": "token", "encryptedToken": "enc-tok" }
    }
  ]
}`

	// Parse
	cfg, err := parseConfig([]byte(input))
	require.NoError(t, err)
	require.Len(t, cfg.Spaces, 2)

	// Verify Core fields are read correctly
	assert.Equal(t, "abc-123", cfg.Spaces[0].ID)
	assert.Equal(t, "my-notes", cfg.Spaces[0].Name)
	assert.Equal(t, "/home/user/notes", cfg.Spaces[0].FolderPath)
	assert.Equal(t, "none", cfg.Spaces[0].Auth.Method)
	assert.Equal(t, "def-456", cfg.Spaces[1].ID)
	assert.Equal(t, "https://wiki.example.com", cfg.Spaces[1].URL)
	assert.Equal(t, "token", cfg.Spaces[1].Auth.Method)
	assert.Equal(t, "enc-tok", cfg.Spaces[1].Auth.EncryptedToken)

	// Modify a Core field
	cfg.Spaces[0].Name = "renamed-notes"

	// Marshal back
	rawSpaces := make([]json.RawMessage, 0, len(cfg.Spaces))
	for _, s := range cfg.Spaces {
		r, err := marshalSpace(s)
		require.NoError(t, err)
		rawSpaces = append(rawSpaces, r)
	}
	wrapper := struct {
		Spaces []json.RawMessage `json:"spaces"`
	}{Spaces: rawSpaces}
	output, err := json.MarshalIndent(wrapper, "", "  ")
	require.NoError(t, err)

	// Re-parse the output as generic JSON to check unknown fields survived
	var generic struct {
		Spaces []map[string]json.RawMessage `json:"spaces"`
	}
	require.NoError(t, json.Unmarshal(output, &generic))
	require.Len(t, generic.Spaces, 2)

	space0 := generic.Spaces[0]

	// Core field was updated
	var name string
	require.NoError(t, json.Unmarshal(space0["name"], &name))
	assert.Equal(t, "renamed-notes", name)

	// App-specific fields survived
	assert.Contains(t, space0, "preferredPort")
	var port int
	require.NoError(t, json.Unmarshal(space0["preferredPort"], &port))
	assert.Equal(t, 3010, port)

	assert.Contains(t, space0, "lastOpened")
	assert.Contains(t, space0, "windows")
	assert.Contains(t, space0, "sync")
	assert.Contains(t, space0, "customAppField")

	var customField string
	require.NoError(t, json.Unmarshal(space0["customAppField"], &customField))
	assert.Equal(t, "should-survive", customField)
}

func TestNewSpaceHasNoRaw(t *testing.T) {
	// A new space created by CLI has no Raw — should marshal cleanly
	s := SpaceConfig{
		ID:   "new-id",
		Name: "new-space",
		URL:  "https://example.com",
		Auth: AuthConfig{Method: "none"},
	}

	data, err := marshalSpace(s)
	require.NoError(t, err)

	var m map[string]any
	require.NoError(t, json.Unmarshal(data, &m))
	assert.Equal(t, "new-id", m["id"])
	assert.Equal(t, "new-space", m["name"])
	assert.Equal(t, "https://example.com", m["url"])
}

func TestNewUUID(t *testing.T) {
	id1 := NewUUID()
	id2 := NewUUID()
	assert.NotEqual(t, id1, id2)
	assert.Len(t, id1, 36) // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
}

func TestResolveSpaceByName(t *testing.T) {
	cfg := &Config{
		Spaces: []SpaceConfig{
			{Name: "alpha", URL: "https://alpha.example.com"},
			{Name: "beta", URL: "https://beta.example.com"},
		},
	}

	space, err := ResolveSpace(cfg, "beta")
	require.NoError(t, err)
	assert.Equal(t, "beta", space.Name)
	assert.Equal(t, "https://beta.example.com", space.URL)
}

func TestResolveSpaceByNameNotFound(t *testing.T) {
	cfg := &Config{
		Spaces: []SpaceConfig{
			{Name: "alpha", URL: "https://alpha.example.com"},
		},
	}

	_, err := ResolveSpace(cfg, "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestResolveSpaceSingle(t *testing.T) {
	cfg := &Config{
		Spaces: []SpaceConfig{
			{Name: "only", URL: "https://only.example.com"},
		},
	}

	space, err := ResolveSpace(cfg, "")
	require.NoError(t, err)
	assert.Equal(t, "only", space.Name)
}

func TestResolveSpaceAmbiguous(t *testing.T) {
	cfg := &Config{
		Spaces: []SpaceConfig{
			{Name: "alpha", URL: "https://alpha.example.com"},
			{Name: "beta", URL: "https://beta.example.com"},
		},
	}

	_, err := ResolveSpace(cfg, "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "multiple spaces")
}

func TestResolveSpaceEmpty(t *testing.T) {
	cfg := &Config{
		Spaces: []SpaceConfig{},
	}

	_, err := ResolveSpace(cfg, "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no spaces configured")
}
