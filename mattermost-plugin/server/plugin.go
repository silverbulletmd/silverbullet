package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/mattermost/mattermost-server/v6/plugin"
	"github.com/mattermost/mattermost-server/v6/shared/mlog"
)

// Plugin implements the interface expected by the Mattermost server to communicate between the server and plugin processes.
type Plugin struct {
	plugin.MattermostPlugin

	// configurationLock synchronizes access to the configuration.
	configurationLock sync.RWMutex

	// configuration is the active plugin configuration. Consult getConfiguration and
	// setConfiguration for usage.
	configuration *configuration
}

// ServeHTTP demonstrates a plugin that handles HTTP requests by greeting the world.
func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {

	if strings.HasPrefix(r.URL.Path, "/page") || strings.HasPrefix(r.URL.Path, "/plug/") {
		p.httpProxy(w, r)
		return
	}
	if r.URL.Path == "/global.plug.json" {
		p.httpProxy(w, r)
		return
	}
	r2, err := http.Get("http://localhost:8065")
	if err != nil {
		fmt.Println(err)
		return
	}
	io.Copy(w, r2.Body)

	// fmt.Fprint(w, "Hello, world!")
}

func (p *Plugin) httpProxy(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	mlog.Info(fmt.Sprintf("Got HTTP request: %s: %s Headers: %+v", r.Method, r.URL, r.Header))
	req, err := http.NewRequest(r.Method, fmt.Sprintf("http://localhost:%d%s", 3000, r.URL), r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Proxy error: %s", err), http.StatusInternalServerError)
		return
	}
	req.Header = r.Header
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("Proxy error: %s", err), http.StatusInternalServerError)
		return
	}
	for k, vs := range res.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(res.StatusCode)
	_, err = io.Copy(w, res.Body)
	if err != nil {
		mlog.Error("Error proxying", mlog.Err(err))
	}
	res.Body.Close()
}

// See https://developers.mattermost.com/extend/plugins/server/reference/
