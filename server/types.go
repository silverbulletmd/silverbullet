package server

import (
	"errors"
	"html/template"
	"net/http"
	"sync"
)

type ServerConfig struct {
	SpaceConfigResolver ConfigResolver

	BindHost          string
	Port              int
	MetricsPort       int
	EnableHTTPLogging bool
	// TODO: Ideally this is configurable per space, but kinda hard
	HostURLPrefix string

	ClientBundle SpacePrimitives
}

type UserPasswordAuthorizer func(username, password string) bool

type SpaceConfig struct {
	Hostname string
	Auth     *AuthOptions

	Authorize UserPasswordAuthorizer

	SpacePrimitives SpacePrimitives

	SpaceFolderPath string
	IndexPage       string
	GitIgnore       string
	ReadOnlyMode    bool
	LogPush         bool

	// Used for the PWA manifest and login page
	SpaceName        string
	SpaceDescription string

	// Used to inject additional HTML into the <head> of index.html
	AdditionalHeadHTML template.HTML

	// Shell configuration
	ShellBackend ShellBackend

	// Auth temporary objects
	JwtIssuer    *Authenticator
	LockoutTimer *LockoutTimer
	authMutex    sync.Mutex
}

type ConfigResolver func(r *http.Request) (*SpaceConfig, error)

// FileMeta represents metadata for a file in the space
type FileMeta struct {
	Name         string `json:"name"`
	Created      int64  `json:"created"`
	LastModified int64  `json:"lastModified"`
	ContentType  string `json:"contentType"`
	Size         int64  `json:"size"`
	Perm         string `json:"perm"` // "ro" or "rw"
}

// SpacePrimitives defines the interface for storage backends
type SpacePrimitives interface {
	// FetchFileList retrieves a list of all files in the space
	FetchFileList() ([]FileMeta, error)

	// GetFileMeta retrieves metadata for a specific file
	GetFileMeta(path string) (FileMeta, error)

	// ReadFile reads a file and returns its data and metadata
	ReadFile(path string) ([]byte, FileMeta, error)

	// WriteFile writes data to a file with optional metadata
	// Returns the actual metadata of the written file
	WriteFile(path string, data []byte, meta *FileMeta) (FileMeta, error)

	// DeleteFile removes a file from the space
	DeleteFile(path string) error
}

// Shell request/response types
type ShellRequest struct {
	Cmd   string   `json:"cmd"`
	Args  []string `json:"args"`
	Stdin *string  `json:"stdin,omitempty"`
}

type ShellResponse struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
	Code   int    `json:"code"`
}

// Shell backend interface
type ShellBackend interface {
	Handle(request ShellRequest) (ShellResponse, error)
}

// Auth options for user authentication
type AuthOptions struct {
	AuthToken       string `json:"authToken,omitempty"`
	User            string `json:"user"`
	Pass            string `json:"pass"`
	LockoutTime     int    `json:"lockoutTime"`  // in seconds
	LockoutLimit    int    `json:"lockoutLimit"`
	RememberMeHours int    `json:"rememberMeHours"` // duration for "remember me" sessions
}

// Common errors
var (
	ErrNotFound        = errors.New("Not found")
	ErrPathOutsideRoot = errors.New("Path not in space")
	ErrCouldNotWrite   = errors.New("Could not write file")
	ErrCouldNotGetMeta = errors.New("Could not get file metadata")
)
