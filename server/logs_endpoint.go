package server

import (
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/render"
)

type LogEntry struct {
	Source    string `json:"source"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	Timestamp int64  `json:"timestamp"`
}

func handleLogsEndpoint(w http.ResponseWriter, r *http.Request) {
	// Limit request body size to prevent OOM (1MB max for log messages)
	r.Body = http.MaxBytesReader(w, r.Body, 1*1024*1024)

	var messages []LogEntry

	if err := render.DecodeJSON(r.Body, &messages); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	for _, message := range messages {
		remoteAddrPieces := strings.Split(r.RemoteAddr, ":")
		log.Printf("[Client %s] [%s %s] %s (%s)", remoteAddrPieces[0], message.Source, message.Level, message.Message, utcDateString(message.Timestamp))
	}
	render.PlainText(w, r, "OK")
}
