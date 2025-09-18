package server

import (
	"net/http"
	"os"

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
func manifestHandler(config *ServerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		spaceConfig := spaceConfigFromContext(r.Context())
		manifest := Manifest{
			ShortName: "SilverBullet",
			Name:      "SilverBullet",
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
			Description:     "Markdown as a platform",
		}

		// Override with environment variables if set
		if os.Getenv("SB_NAME") != "" {
			manifest.Name = os.Getenv("SB_NAME")
			manifest.ShortName = os.Getenv("SB_NAME")
		}
		if os.Getenv("SB_DESCRIPTION") != "" {
			manifest.Description = os.Getenv("SB_DESCRIPTION")
		}

		if spaceConfig.HostURLPrefix != "" {
			manifest.Icons[0].Src = spaceConfig.HostURLPrefix + manifest.Icons[0].Src
			manifest.StartURL = spaceConfig.HostURLPrefix + manifest.StartURL
			manifest.Scope = spaceConfig.HostURLPrefix + manifest.Scope
		}

		render.JSON(w, r, manifest)
	}
}
