package cli

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
)

var validName = regexp.MustCompile(`^[a-zA-Z0-9-]+$`)

func SpaceCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "space",
		Short: "Manage space connections",
	}
	cmd.AddCommand(spaceAddCommand(), spaceListCommand(), spaceRemoveCommand())
	return cmd
}

func spaceAddCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "add",
		Short: "Add a new space",
		RunE: func(cmd *cobra.Command, args []string) error {
			return SpaceAddInteractive(nil)
		},
	}
}

// SpaceAddInteractive runs the interactive space-add flow.
// If presetURL is non-nil, it skips the URL prompt (used by App to extend this).
func SpaceAddInteractive(presetURL *string) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	reader := bufio.NewReader(os.Stdin)

	// Name
	fmt.Print("Space name: ")
	name, _ := reader.ReadString('\n')
	name = strings.TrimSpace(name)
	if !validName.MatchString(name) {
		return fmt.Errorf("name must be alphanumeric with hyphens only")
	}
	for _, s := range cfg.Spaces {
		if s.Name == name {
			return fmt.Errorf("space %q already exists", name)
		}
	}

	// URL
	var spaceURL string
	if presetURL != nil {
		spaceURL = *presetURL
	} else {
		fmt.Print("URL (e.g. http://localhost:3000): ")
		spaceURL, _ = reader.ReadString('\n')
		spaceURL = strings.TrimSpace(spaceURL)
	}
	if _, err := url.ParseRequestURI(spaceURL); err != nil {
		return fmt.Errorf("invalid URL format")
	}
	spaceURL = strings.TrimRight(spaceURL, "/")

	// Probe the server to check reachability and whether auth is required
	authType := "none"
	conn, _ := NewSpaceConnection(ConnectionOpts{URL: spaceURL})
	if conn != nil {
		reachable, needsAuth := conn.Probe()
		if !reachable {
			fmt.Fprintln(os.Stderr, "Warning: could not reach server at that URL (saving anyway)")
			fmt.Print("Auth type (token / password / none) [none]: ")
			authInput, _ := reader.ReadString('\n')
			authType = strings.TrimSpace(authInput)
			if authType == "" {
				authType = "none"
			}
		} else if needsAuth {
			fmt.Println("Server requires authentication.")
			fmt.Print("Auth type (password / token) [password]:")
			authInput, _ := reader.ReadString('\n')
			authType = strings.TrimSpace(authInput)
			if authType == "" {
				authType = "password"
			}
		} else {
			fmt.Println("Server is reachable (no authentication required).")
		}
	}
	if authType != "token" && authType != "password" && authType != "none" {
		return fmt.Errorf("auth type must be token, password, or none")
	}

	space := SpaceConfig{
		ID:   NewUUID(),
		Name: name,
		URL:  spaceURL,
		Auth: AuthConfig{Method: authType},
	}

	for authType != "none" {
		if authType == "token" {
			fmt.Print("Token: ")
			token, _ := reader.ReadString('\n')
			token = strings.TrimSpace(token)
			enc, err := Encrypt(token)
			if err != nil {
				return fmt.Errorf("encrypting token: %w", err)
			}
			space.Auth.EncryptedToken = enc
			space.Auth.EncryptedPassword = ""
			space.Auth.Username = ""
		} else if authType == "password" {
			fmt.Print("Username: ")
			username, _ := reader.ReadString('\n')
			space.Auth.Username = strings.TrimSpace(username)
			fmt.Print("Password: ")
			password, _ := reader.ReadString('\n')
			password = strings.TrimSpace(password)
			enc, err := Encrypt(password)
			if err != nil {
				return fmt.Errorf("encrypting password: %w", err)
			}
			space.Auth.EncryptedPassword = enc
			space.Auth.EncryptedToken = ""
		}
		space.Auth.Method = authType

		verifyConn, err := NewSpaceConnection(ConnectionOpts{Space: &space})
		if err != nil {
			return fmt.Errorf("creating connection: %w", err)
		}
		if verifyConn.AuthCheck() {
			fmt.Println("Authentication verified.")
			break
		}
		fmt.Println("Authentication failed. Try again.")
		fmt.Print("Auth type (password / token) [password]:")
		authInput, _ := reader.ReadString('\n')
		authType = strings.TrimSpace(authInput)
		if authType == "" {
			authType = "password"
		}
		if authType != "token" && authType != "password" {
			return fmt.Errorf("auth type must be token or password")
		}
	}

	cfg.Spaces = append(cfg.Spaces, space)
	if err := SaveConfig(cfg); err != nil {
		return err
	}
	fmt.Printf("Space %q added.\n", name)
	return nil
}

func spaceListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List configured spaces",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := LoadConfig()
			if err != nil {
				return err
			}
			if len(cfg.Spaces) == 0 {
				fmt.Println("No spaces configured. Use 'space add' to add one.")
				return nil
			}
			fmt.Println()
			fmt.Printf("%-20s%-40s%s\n", "NAME", "URL", "AUTH")
			fmt.Println(strings.Repeat("-", 70))
			for _, s := range cfg.Spaces {
				u := s.URL
				if u == "" && s.FolderPath != "" {
					u = s.FolderPath
				}
				fmt.Printf("%-20s%-40s%s\n", s.Name, u, s.Auth.Method)
			}
			fmt.Println()
			return nil
		},
	}
}

func spaceRemoveCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a space",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			cfg, err := LoadConfig()
			if err != nil {
				return err
			}
			idx := -1
			for i, s := range cfg.Spaces {
				if s.Name == name {
					idx = i
					break
				}
			}
			if idx == -1 {
				return fmt.Errorf("space %q not found", name)
			}
			cfg.Spaces = append(cfg.Spaces[:idx], cfg.Spaces[idx+1:]...)
			if err := SaveConfig(cfg); err != nil {
				return err
			}
			fmt.Printf("Space %q removed.\n", name)
			return nil
		},
	}
}
