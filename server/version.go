package server

import (
	"fmt"
	"regexp"
	"strings"
)

func ParseVersionFromTypeScript(code string) (string, error) {
	// Parse the version using regex
	re := regexp.MustCompile(`"([^"]+)"`)
	matches := re.FindStringSubmatch(code)

	if len(matches) < 2 {
		return "", fmt.Errorf("version not found in file")
	}

	version := strings.TrimSpace(matches[1])
	if version == "" {
		return "", fmt.Errorf("empty version found")
	}

	return version, nil
}
