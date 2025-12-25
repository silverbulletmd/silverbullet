package server

import (
	"net/http"

	"github.com/go-chi/render"
)

// ManifestIcon represents an icon in the PWA manifest
type ManifestIcon struct {
	Src   string `json:"src"`
	Type  string `json:"type"`
	Sizes string `json:"sizes"`
}

// Manifest represents the structure of a PWA manifest.json file
type Manifest struct {
	ShortName       string         `json:"short_name"`
	Name            string         `json:"name"`
	Icons           []ManifestIcon `json:"icons"`
	CaptureLinks    string         `json:"capture_links"`
	StartURL        string         `json:"start_url"`
	Display         string         `json:"display"`
	DisplayOverride []string       `json:"display_override"`
	Scope           string         `json:"scope"`
	ThemeColor      string         `json:"theme_color"`
	Description     string         `json:"description"`
}

// Generate PWA manifest.json with dynamic values
func manifestHandler(w http.ResponseWriter, r *http.Request) {
	spaceConfig, ok := spaceConfigFromContext(r.Context())
	if !ok {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	config, ok := serverConfigFromContext(r.Context())
	if !ok {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	manifest := Manifest{
		ShortName: spaceConfig.SpaceName,
		Name:      spaceConfig.SpaceName,
		Icons: []ManifestIcon{
			{
				Src:   "/.client/logo-dock.png",
				Type:  "image/png",
				Sizes: "512x512",
			},
		},
		CaptureLinks:    "new-client",
		StartURL:        "/#boot",
		Display:         "standalone",
		DisplayOverride: []string{"window-controls-overlay"},
		Scope:           "/",
		ThemeColor:      "#e1e1e1",
		Description:     spaceConfig.SpaceDescription,
	}

	if config.HostURLPrefix != "" {
		manifest.Icons[0].Src = config.HostURLPrefix + manifest.Icons[0].Src
		manifest.StartURL = config.HostURLPrefix + manifest.StartURL
		manifest.Scope = config.HostURLPrefix + manifest.Scope
	}

	render.JSON(w, r, manifest)
}
