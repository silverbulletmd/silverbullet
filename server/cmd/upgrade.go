package cmd

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/google/renameio"
	"github.com/spf13/cobra"
)

// We can add more now that this will be Go compiled (we can do ARM32 too, for instance)
var archMappings map[string]string = map[string]string{
	"amd64": "x86_64",
	"arm64": "aarch64",
}

func UpgradeCommand() *cobra.Command {
	return &cobra.Command{
		Use: "upgrade",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println("Now going to attempt an upgrade...")
			if err := upgrade("https://github.com/silverbulletmd/silverbullet/releases/latest/download"); err != nil {
				log.Fatal(err)
			}
		},
	}
}

func UpgradeEdgeCommand() *cobra.Command {
	return &cobra.Command{
		Use: "upgrade-edge",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println("Now going to attempt an upgrade...")
			if err := upgrade("https://github.com/silverbulletmd/silverbullet/releases/download/edge"); err != nil {
				log.Fatal(err)
			}
		},
	}
}

func upgrade(urlPrefix string) error {
	// Get the directory of the current executable
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	installDir := filepath.Dir(execPath)

	fmt.Println("Install dir:", installDir)

	// Create temporary directory
	tmpDir, err := os.MkdirTemp("", "silverbullet-upgrade")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Construct download URL
	zipURL := fmt.Sprintf("%s/silverbullet-server-%s-%s.zip", urlPrefix, runtime.GOOS, archMappings[runtime.GOARCH])
	zipPath := filepath.Join(tmpDir, "silverbullet.zip")

	fmt.Println("Downloading from", zipURL)

	// Download the zip file
	resp, err := http.Get(zipURL)
	if err != nil {
		return fmt.Errorf("failed to download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	// Create the zip file
	zipFile, err := os.Create(zipPath)
	if err != nil {
		return fmt.Errorf("failed to create zip file: %w", err)
	}
	defer zipFile.Close()

	// Copy response body to file
	_, err = io.Copy(zipFile, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to save zip file: %w", err)
	}
	zipFile.Close()

	fmt.Printf("Now going to replace the existing silverbullet binary in %s\n", installDir)

	// Extract the zip file
	err = extractZip(tmpDir, zipPath, installDir)
	if err != nil {
		return fmt.Errorf("failed to extract zip: %w", err)
	}

	// Set executable permissions on the binary
	binaryPath := filepath.Join(installDir, "silverbullet")
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}
	err = os.Chmod(binaryPath, 0755)
	if err != nil {
		return fmt.Errorf("failed to set executable permissions: %w", err)
	}

	fmt.Println("And done! Restart your server to get the latest and greatest!")
	return nil
}

func extractZip(tmpDir, src, dest string) error {
	reader, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer reader.Close()

	for _, file := range reader.File {
		path := filepath.Join(dest, file.Name)

		// Handle directories first, report errors here too
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(path, file.FileInfo().Mode()); err != nil {
				return err
			}
			continue
		}

		rc, err := file.Open()
		if err != nil {
			return err
		}
		defer rc.Close()

		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}

		// Create the file as a temporary file first
		tempFile, err := renameio.TempFile(tmpDir, path)
		if err != nil {
			return err
		}
		defer tempFile.Cleanup()

		// Extract to the temporary file
		_, err = io.Copy(tempFile, rc)
		if err != nil {
			return err
		}

		// Properly set the mode of the target file
		if err := tempFile.Chmod(file.FileInfo().Mode()); err != nil {
			return err
		}

		// Atomically create the target file
		if err := tempFile.CloseAtomicallyReplace(); err != nil {
			return err
		}
	}

	return nil
}
