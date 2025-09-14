package server_go

import (
	"os"
	"runtime"
	"syscall"
	"time"
)

// getCreationTime extracts creation time from file info
// This is platform-specific and may not be available on all systems
func getCreationTime(info os.FileInfo) *time.Time {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		var creationTime time.Time

		switch runtime.GOOS {
		case "darwin":
		case "linux":
			// On macOS, use Ctimespec which is available
			creationTime = time.Unix(stat.Ctimespec.Sec, stat.Ctimespec.Nsec)
		default:
			// For other Unix systems, fall back to modification time
			return nil
		}

		return &creationTime
	}

	// If we can't get creation time, return nil
	// The caller will fall back to modification time
	return nil
}
