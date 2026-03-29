package cli

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

type AuthConfig struct {
	Method            string `json:"method"` // "token", "password", or "none"
	EncryptedToken    string `json:"encryptedToken,omitempty"`
	Username          string `json:"username,omitempty"`
	EncryptedPassword string `json:"encryptedPassword,omitempty"`
}

type SpaceEnv struct {
	IndexPage    string `json:"indexPage,omitempty"`
	ReadOnly     bool   `json:"readOnly,omitempty"`
	ShellBackend string `json:"shellBackend,omitempty"`
}

// SpaceConfig holds the fields Core understands.
// The Raw field preserves the original JSON so App-specific fields survive round-trips.
type SpaceConfig struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	URL        string     `json:"url,omitempty"`
	FolderPath string     `json:"folderPath,omitempty"`
	Auth       AuthConfig `json:"auth"`
	Env        *SpaceEnv  `json:"env,omitempty"`

	Raw json.RawMessage `json:"-"`
}

type Config struct {
	Spaces []SpaceConfig
}

func ConfigDir() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "silverbullet")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "silverbullet")
}

func configPath() string {
	return filepath.Join(ConfigDir(), "config.json")
}

// LoadConfig reads the config file, preserving unknown fields per-space via Raw.
func LoadConfig() (*Config, error) {
	data, err := os.ReadFile(configPath())
	if err != nil {
		if os.IsNotExist(err) {
			return &Config{Spaces: []SpaceConfig{}}, nil
		}
		return nil, err
	}
	return parseConfig(data)
}

func parseConfig(data []byte) (*Config, error) {
	var raw struct {
		Spaces []json.RawMessage `json:"spaces"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	spaces := make([]SpaceConfig, 0, len(raw.Spaces))
	for _, r := range raw.Spaces {
		s, err := unmarshalSpace(r)
		if err != nil {
			return nil, fmt.Errorf("parsing space entry: %w", err)
		}
		spaces = append(spaces, s)
	}
	return &Config{Spaces: spaces}, nil
}

func unmarshalSpace(raw json.RawMessage) (SpaceConfig, error) {
	var s SpaceConfig
	if err := json.Unmarshal(raw, &s); err != nil {
		return s, err
	}
	s.Raw = raw
	return s, nil
}

// marshalSpace produces JSON that merges Core's known fields back into the
// original raw JSON, preserving any fields Core doesn't model.
func marshalSpace(s SpaceConfig) (json.RawMessage, error) {
	if s.Raw == nil {
		return json.Marshal(s)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(s.Raw, &m); err != nil {
		return nil, err
	}
	// Overlay Core's known fields
	setField(m, "id", s.ID)
	setField(m, "name", s.Name)
	if s.URL != "" {
		setField(m, "url", s.URL)
	} else {
		delete(m, "url")
	}
	if s.FolderPath != "" {
		setField(m, "folderPath", s.FolderPath)
	} else {
		delete(m, "folderPath")
	}
	setField(m, "auth", s.Auth)
	if s.Env != nil {
		setField(m, "env", s.Env)
	} else {
		delete(m, "env")
	}
	return json.Marshal(m)
}

func setField(m map[string]json.RawMessage, key string, value any) {
	b, _ := json.Marshal(value)
	m[key] = b
}

func SaveConfig(cfg *Config) error {
	dir := ConfigDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	rawSpaces := make([]json.RawMessage, 0, len(cfg.Spaces))
	for _, s := range cfg.Spaces {
		r, err := marshalSpace(s)
		if err != nil {
			return fmt.Errorf("marshaling space %q: %w", s.Name, err)
		}
		rawSpaces = append(rawSpaces, r)
	}
	wrapper := struct {
		Spaces []json.RawMessage `json:"spaces"`
	}{Spaces: rawSpaces}
	data, err := json.MarshalIndent(wrapper, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(configPath(), data, 0600)
}

func ResolveSpace(cfg *Config, name string) (*SpaceConfig, error) {
	if name != "" {
		for i := range cfg.Spaces {
			if cfg.Spaces[i].Name == name {
				return &cfg.Spaces[i], nil
			}
		}
		return nil, fmt.Errorf("space %q not found", name)
	}
	if len(cfg.Spaces) == 1 {
		return &cfg.Spaces[0], nil
	}
	if len(cfg.Spaces) == 0 {
		return nil, fmt.Errorf("no spaces configured; use 'space add' or pass --url")
	}
	return nil, fmt.Errorf("multiple spaces configured; use -s <name> to select one")
}

// NewUUID generates a random UUID v4 string.
func NewUUID() string {
	var uuid [16]byte
	rand.Read(uuid[:])
	uuid[6] = (uuid[6] & 0x0f) | 0x40 // version 4
	uuid[8] = (uuid[8] & 0x3f) | 0x80 // variant 1
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
}

// Encryption: AES-256-GCM with PBKDF2 key derivation.
func deriveKey() []byte {
	hostname, _ := os.Hostname()
	u, _ := user.Current()
	username := ""
	if u != nil {
		username = u.Username
	}
	material := hostname + username + "silverbullet-cli"
	return pbkdf2.Key([]byte(material), []byte("silverbullet-cli-salt"), 100000, 32, sha256.New)
}

func Encrypt(plaintext string) (string, error) {
	key := deriveKey()
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, gcm.NonceSize()) // 12 bytes for GCM
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	// GCM appends the tag to the ciphertext. Split them to match Node.js format.
	tagSize := gcm.Overhead() // 16 bytes
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	return fmt.Sprintf("%s:%s:%s",
		base64.StdEncoding.EncodeToString(iv),
		base64.StdEncoding.EncodeToString(tag),
		base64.StdEncoding.EncodeToString(ciphertext),
	), nil
}

func Decrypt(encoded string) (string, error) {
	parts := strings.SplitN(encoded, ":", 3)
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid encrypted format")
	}
	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("decoding iv: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decoding tag: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("decoding ciphertext: %w", err)
	}

	key := deriveKey()
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	// GCM expects ciphertext+tag concatenated
	sealed := append(ciphertext, tag...)
	plaintext, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}
	return string(plaintext), nil
}
