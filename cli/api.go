package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/silverbulletmd/silverbullet/server"
)

type apiResponse struct {
	Result any    `json:"result"`
	Error  string `json:"error"`
}

type SpaceConnection struct {
	baseURL     string
	token       string
	spaceConfig *SpaceConfig
	cachedJWT   string
	cookieName  string
	Timeout     time.Duration
}

type ConnectionOpts struct {
	Space   *SpaceConfig
	URL     string
	Token   string
	Timeout time.Duration
}

func NewSpaceConnection(opts ConnectionOpts) (*SpaceConnection, error) {
	conn := &SpaceConnection{
		Timeout: opts.Timeout,
		token:   opts.Token,
	}
	if conn.Timeout == 0 {
		conn.Timeout = 30 * time.Second
	}
	if opts.URL != "" {
		conn.baseURL = strings.TrimRight(opts.URL, "/")
	} else if opts.Space != nil {
		conn.baseURL = strings.TrimRight(opts.Space.URL, "/")
		conn.spaceConfig = opts.Space
	} else {
		return nil, fmt.Errorf("no URL or space configured")
	}
	return conn, nil
}

func (c *SpaceConnection) client() *http.Client {
	return &http.Client{
		Timeout: c.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func (c *SpaceConnection) buildHeaders() (http.Header, error) {
	h := http.Header{}
	if c.token != "" {
		h.Set("Authorization", "Bearer "+c.token)
		return h, nil
	}
	if c.spaceConfig == nil {
		return h, nil
	}
	s := c.spaceConfig
	switch s.Auth.Method {
	case "token":
		if s.Auth.EncryptedToken != "" {
			tok, err := Decrypt(s.Auth.EncryptedToken)
			if err != nil {
				return nil, fmt.Errorf("decrypting token: %w", err)
			}
			h.Set("Authorization", "Bearer "+tok)
		}
	case "password":
		jwt, cookieName, err := c.loginForJWT()
		if err != nil {
			return nil, err
		}
		h.Set("Cookie", cookieName+"="+jwt)
	}
	return h, nil
}

func (c *SpaceConnection) loginForJWT() (string, string, error) {
	if c.cachedJWT != "" {
		return c.cachedJWT, c.cookieName, nil
	}
	s := c.spaceConfig
	password, err := Decrypt(s.Auth.EncryptedPassword)
	if err != nil {
		return "", "", fmt.Errorf("decrypting password: %w", err)
	}
	form := url.Values{}
	form.Set("username", s.Auth.Username)
	form.Set("password", password)
	req, err := http.NewRequest("POST", c.baseURL+"/.auth", strings.NewReader(form.Encode()))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.client().Do(req)
	if err != nil {
		return "", "", fmt.Errorf("login request failed: %w", err)
	}
	defer resp.Body.Close()

	setCookie := resp.Header.Get("Set-Cookie")
	if setCookie == "" {
		return "", "", fmt.Errorf("login failed (status %d): no auth cookie returned", resp.StatusCode)
	}
	// Parse "auth_xxx=<jwt>; ..." format
	for _, part := range strings.Split(setCookie, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "auth_") {
			eqIdx := strings.Index(part, "=")
			if eqIdx > 0 {
				c.cookieName = part[:eqIdx]
				c.cachedJWT = part[eqIdx+1:]
				return c.cachedJWT, c.cookieName, nil
			}
		}
	}
	return "", "", fmt.Errorf("login failed: could not extract auth token from cookie")
}

func (c *SpaceConnection) apiPost(endpoint string, body string) (any, error) {
	headers, err := c.buildHeaders()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest("POST", c.baseURL+endpoint, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header = headers
	req.Header.Set("Content-Type", "text/plain")

	resp, err := c.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || (resp.StatusCode >= 300 && resp.StatusCode < 400) {
		return nil, fmt.Errorf("authentication required; use --token, or configure a space with 'space add'")
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var data apiResponse
	if err := json.Unmarshal(respBody, &data); err != nil {
		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(respBody))
		}
		return nil, fmt.Errorf("invalid JSON response: %w", err)
	}
	if data.Error != "" {
		return nil, fmt.Errorf("%s", data.Error)
	}
	return data.Result, nil
}

func (c *SpaceConnection) apiGet(endpoint string, params map[string]string) (*http.Response, error) {
	headers, err := c.buildHeaders()
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(c.baseURL + endpoint)
	if err != nil {
		return nil, err
	}
	if params != nil {
		q := u.Query()
		for k, v := range params {
			q.Set(k, v)
		}
		u.RawQuery = q.Encode()
	}
	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header = headers

	resp, err := c.client().Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 401 || (resp.StatusCode >= 300 && resp.StatusCode < 400) {
		resp.Body.Close()
		return nil, fmt.Errorf("authentication required; use --token, or configure a space with 'space add'")
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}
	return resp, nil
}

func (c *SpaceConnection) EvalLua(expression string) (any, error) {
	return c.apiPost("/.runtime/lua", expression)
}

func (c *SpaceConnection) EvalLuaScript(script string) (any, error) {
	return c.apiPost("/.runtime/lua_script", script)
}

func (c *SpaceConnection) Logs(limit int, since int64) ([]server.ConsoleLogEntry, error) {
	params := map[string]string{}
	if limit > 0 {
		params["limit"] = fmt.Sprintf("%d", limit)
	}
	if since > 0 {
		params["since"] = fmt.Sprintf("%d", since)
	}
	resp, err := c.apiGet("/.runtime/logs", params)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var data struct {
		Logs []server.ConsoleLogEntry `json:"logs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data.Logs, nil
}

func (c *SpaceConnection) Screenshot() ([]byte, error) {
	resp, err := c.apiGet("/.runtime/screenshot", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// AuthCheck verifies that the connection's credentials are accepted by the server.
// Unlike Ping, this hits an authenticated endpoint (/.config).
func (c *SpaceConnection) AuthCheck() bool {
	resp, err := c.apiGet("/.config", nil)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

func (c *SpaceConnection) Ping() bool {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(c.baseURL + "/.ping")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// Probe checks whether the server is reachable and whether it requires authentication.
// Returns (reachable, needsAuth). It uses /.config (which is behind auth) to detect
// whether authentication is required, and falls back to /.ping for reachability.
func (c *SpaceConnection) Probe() (bool, bool) {
	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	// /.config is behind the auth middleware (unlike /.ping which is excluded)
	resp, err := client.Get(c.baseURL + "/.config")
	if err != nil {
		return false, false
	}
	resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, false
	}
	if resp.StatusCode == 401 || (resp.StatusCode >= 300 && resp.StatusCode < 400) {
		return true, true
	}
	return false, false
}
