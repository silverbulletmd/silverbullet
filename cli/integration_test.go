//go:build integration

package cli_test

import (
	"testing"
	"time"

	"github.com/silverbulletmd/silverbullet/cli"
	"github.com/silverbulletmd/silverbullet/server/servertest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testAuthUser = "admin"
const testAuthPass = "secret"
const testAuthToken = "test-api-token"

func newConn(t *testing.T, ts *servertest.TestServer, token string) *cli.SpaceConnection {
	t.Helper()
	conn, err := cli.NewSpaceConnection(cli.ConnectionOpts{
		URL:     ts.Server.URL,
		Token:   token,
		Timeout: 30 * time.Second,
	})
	require.NoError(t, err)
	return conn
}

// --- Tests against headless server (with Chrome, Runtime API) ---

func TestCLI_EvalLua(t *testing.T) {
	ts := servertest.StartHeadless(t)
	conn := newConn(t, ts, "")

	result, err := conn.EvalLua("1 + 1")
	require.NoError(t, err)
	assert.Equal(t, float64(2), result)
}

func TestCLI_EvalLuaScript(t *testing.T) {
	ts := servertest.StartHeadless(t)
	conn := newConn(t, ts, "")

	script := `local x = 10
local y = 20
return x + y`

	result, err := conn.EvalLuaScript(script)
	require.NoError(t, err)
	assert.Equal(t, float64(30), result)
}

func TestCLI_Screenshot(t *testing.T) {
	ts := servertest.StartHeadless(t)
	conn := newConn(t, ts, "")

	data, err := conn.Screenshot()
	require.NoError(t, err)
	require.True(t, len(data) > 100, "screenshot should be non-trivial size")
	// PNG magic bytes
	assert.Equal(t, byte(0x89), data[0])
	assert.Equal(t, byte('P'), data[1])
	assert.Equal(t, byte('N'), data[2])
	assert.Equal(t, byte('G'), data[3])
}

func TestCLI_Logs(t *testing.T) {
	ts := servertest.StartHeadless(t)
	conn := newConn(t, ts, "")

	logs, err := conn.Logs(10, 0)
	require.NoError(t, err)
	require.NotEmpty(t, logs, "logs should not be empty after client boot")

	assert.NotEmpty(t, logs[0].Level)
	assert.NotEmpty(t, logs[0].Text)
	assert.NotZero(t, logs[0].Timestamp)
}

func TestCLI_LogsSince(t *testing.T) {
	ts := servertest.StartHeadless(t)
	conn := newConn(t, ts, "")

	// Get initial logs
	logs, err := conn.Logs(100, 0)
	require.NoError(t, err)
	require.NotEmpty(t, logs)

	// Find the last timestamp
	var lastTimestamp int64
	for _, entry := range logs {
		if entry.Timestamp > lastTimestamp {
			lastTimestamp = entry.Timestamp
		}
	}

	// Fetch logs since that timestamp — should return no duplicates
	newLogs, err := conn.Logs(0, lastTimestamp)
	require.NoError(t, err)

	for _, entry := range newLogs {
		assert.Greater(t, entry.Timestamp, lastTimestamp,
			"all entries should be newer than the since timestamp")
	}
}

func TestCLI_Ping(t *testing.T) {
	ts := servertest.StartHeadless(t)
	conn := newConn(t, ts, "")

	assert.True(t, conn.Ping())
}

// --- Auth tests ---

func TestCLI_TokenAuth(t *testing.T) {
	ts := servertest.StartHeadless(t,
		servertest.WithAuth(testAuthUser, testAuthPass, testAuthToken),
	)
	conn := newConn(t, ts, testAuthToken)

	result, err := conn.EvalLua("1 + 1")
	require.NoError(t, err)
	assert.Equal(t, float64(2), result)
}

func TestCLI_WrongTokenAuth(t *testing.T) {
	ts := servertest.StartHeadless(t,
		servertest.WithAuth(testAuthUser, testAuthPass, testAuthToken),
	)
	conn := newConn(t, ts, "wrong-token")

	_, err := conn.EvalLua("1 + 1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "authentication")
}

func TestCLI_NoAuth(t *testing.T) {
	ts := servertest.StartHeadless(t,
		servertest.WithAuth(testAuthUser, testAuthPass, testAuthToken),
	)
	conn := newConn(t, ts, "")

	_, err := conn.EvalLua("1 + 1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "authentication")
}

func TestCLI_PasswordAuth(t *testing.T) {
	ts := servertest.StartHeadless(t,
		servertest.WithAuth(testAuthUser, testAuthPass, testAuthToken),
	)

	// Encrypt the password so SpaceConnection can decrypt it for loginForJWT
	encPass, err := cli.Encrypt(testAuthPass)
	require.NoError(t, err)

	conn, err := cli.NewSpaceConnection(cli.ConnectionOpts{
		Space: &cli.SpaceConfig{
			Name: "test",
			URL:  ts.Server.URL,
			Auth: cli.AuthConfig{
				Method:            "password",
				Username:          testAuthUser,
				EncryptedPassword: encPass,
			},
		},
		Timeout: 30 * time.Second,
	})
	require.NoError(t, err)

	result, err := conn.EvalLua("1 + 1")
	require.NoError(t, err)
	assert.Equal(t, float64(2), result)
}
