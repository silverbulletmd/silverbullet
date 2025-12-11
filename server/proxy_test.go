package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLocalhostRegex(t *testing.T) {
	// Should match (use HTTP)
	shouldMatch := []string{
		"localhost:8080/api",
		"127.0.0.1:8080/api",
		"192.168.1.1:8080/api",
		"host.docker.internal:11434/api",
	}

	// Should NOT match (use HTTPS)
	shouldNotMatch := []string{
		"api.openai.com/v1",
		"example.com:8443/api",
		"",
	}

	for _, input := range shouldMatch {
		assert.True(t, localhostRegex.MatchString(input), "should match: %s", input)
	}

	for _, input := range shouldNotMatch {
		assert.False(t, localhostRegex.MatchString(input), "should not match: %s", input)
	}
}
