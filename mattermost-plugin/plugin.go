package root

import (
	_ "embed" // Need to embed manifest file
	"encoding/json"
	"strings"

	"github.com/mattermost/mattermost-server/v6/model"
)

//go:embed plugin.json
var manifestString string

var Manifest model.Manifest

func init() {
	_ = json.NewDecoder(strings.NewReader(manifestString)).Decode(&Manifest)
}
