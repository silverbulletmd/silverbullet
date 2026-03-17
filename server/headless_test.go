package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHeadlessConfigConstruction(t *testing.T) {
	config := &HeadlessConfig{
		ServerURL:  "http://127.0.0.1:3000",
		ChromePath: "/usr/bin/chromium",
	}

	assert.Equal(t, "http://127.0.0.1:3000", config.ServerURL)
	assert.Equal(t, "/usr/bin/chromium", config.ChromePath)
	assert.Empty(t, config.HeadlessToken)
}

func TestHeadlessConfigWithToken(t *testing.T) {
	config := &HeadlessConfig{
		ServerURL:     "http://127.0.0.1:3000",
		HeadlessToken: "abc123",
	}

	assert.Equal(t, "abc123", config.HeadlessToken)
}

func TestHeadlessBrowserStartFailsWithoutChrome(t *testing.T) {
	config := &HeadlessConfig{
		ServerURL:  "http://127.0.0.1:9999",
		ChromePath: "/nonexistent/chrome",
	}

	hb, err := StartHeadlessBrowser(config)
	assert.Error(t, err, "should fail when Chrome binary is not found")
	assert.Nil(t, hb)
}
