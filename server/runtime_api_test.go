package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandleLuaAPI_EmptyBody(t *testing.T) {
	bridge := NewRuntimeBridge(nil)

	req := httptest.NewRequest(http.MethodPost, "/.runtime/lua", strings.NewReader(""))
	w := httptest.NewRecorder()

	bridge.HandleLuaAPI(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleLuaAPI_NoBrowser(t *testing.T) {
	bridge := NewRuntimeBridge(nil)

	req := httptest.NewRequest(http.MethodPost, "/.runtime/lua", strings.NewReader("1 + 1"))
	w := httptest.NewRecorder()

	bridge.HandleLuaAPI(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "No headless browser running")
}

func TestHandleLuaScriptAPI_EmptyBody(t *testing.T) {
	bridge := NewRuntimeBridge(nil)

	req := httptest.NewRequest(http.MethodPost, "/.runtime/lua_script", strings.NewReader(""))
	w := httptest.NewRecorder()

	bridge.HandleLuaScriptAPI(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandleLuaScriptAPI_NoBrowser(t *testing.T) {
	bridge := NewRuntimeBridge(nil)

	req := httptest.NewRequest(http.MethodPost, "/.runtime/lua_script", strings.NewReader("local x = 1\nreturn x"))
	w := httptest.NewRecorder()

	bridge.HandleLuaScriptAPI(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "No headless browser running")
}
