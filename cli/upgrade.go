package cli

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
)

var archMappings = map[string]string{
	"amd64": "x86_64",
	"arm64": "aarch64",
}

func UpgradeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "upgrade",
		Short: "Upgrade to the latest stable release",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("Upgrading silverbullet-cli...")
			return upgradeCLI("https://github.com/silverbulletmd/silverbullet/releases/latest/download")
		},
	}
}

func UpgradeEdgeCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "upgrade-edge",
		Short: "Upgrade to the latest edge release",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("Upgrading silverbullet-cli to edge...")
			return upgradeCLI("https://github.com/silverbulletmd/silverbullet/releases/download/edge")
		},
	}
}

func upgradeCLI(urlPrefix string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	installDir := filepath.Dir(execPath)

	fmt.Println("Install dir:", installDir)

	tmpDir, err := os.MkdirTemp("", "silverbullet-cli-upgrade")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	arch, ok := archMappings[runtime.GOARCH]
	if !ok {
		return fmt.Errorf("unsupported architecture: %s", runtime.GOARCH)
	}
	zipURL := fmt.Sprintf("%s/silverbullet-cli-%s-%s.zip", urlPrefix, runtime.GOOS, arch)
	zipPath := filepath.Join(tmpDir, "silverbullet-cli.zip")

	fmt.Println("Downloading from", zipURL)

	resp, err := http.Get(zipURL)
	if err != nil {
		return fmt.Errorf("failed to download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	zipFile, err := os.Create(zipPath)
	if err != nil {
		return fmt.Errorf("failed to create zip file: %w", err)
	}
	defer zipFile.Close()

	_, err = io.Copy(zipFile, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to save zip file: %w", err)
	}
	zipFile.Close()

	fmt.Printf("Replacing silverbullet-cli binary in %s\n", installDir)

	if err := extractZip(zipPath, installDir); err != nil {
		return fmt.Errorf("failed to extract zip: %w", err)
	}

	binaryName := "silverbullet-cli"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	binaryPath := filepath.Join(installDir, binaryName)
	if err := os.Chmod(binaryPath, 0755); err != nil {
		return fmt.Errorf("failed to set executable permissions: %w", err)
	}

	fmt.Println("Upgrade complete!")
	return nil
}

func extractZip(src, dest string) error {
	reader, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer reader.Close()

	for _, file := range reader.File {
		if err := extractZipFile(file, dest); err != nil {
			return err
		}
	}
	return nil
}

func extractZipFile(file *zip.File, dest string) error {
	path := filepath.Join(dest, file.Name)

	// Prevent zip-slip: ensure extracted path stays within dest
	cleanDest := filepath.Clean(dest) + string(os.PathSeparator)
	if !strings.HasPrefix(filepath.Clean(path)+string(os.PathSeparator), cleanDest) && filepath.Clean(path) != filepath.Clean(dest) {
		return fmt.Errorf("illegal file path in zip: %s", file.Name)
	}

	if file.FileInfo().IsDir() {
		return os.MkdirAll(path, file.FileInfo().Mode())
	}

	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	// Remove first to prevent "text file busy" error
	err = os.Remove(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}

	outFile, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.FileInfo().Mode())
	if err != nil {
		return err
	}
	defer outFile.Close()

	_, err = io.Copy(outFile, rc)
	return err
}
