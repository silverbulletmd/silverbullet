package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestVersionParsing(t *testing.T) {
	version, err := ParseVersionFromTypeScript(`export const publicVersion = "2.0.0"`)
	assert.NoError(t, err)
	assert.Equal(t, "2.0.0", version)
}
