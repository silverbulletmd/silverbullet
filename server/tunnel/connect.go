package tunnel

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type TunnelConnection struct {
	// Local port to proxy the HTTP request to
	localProxyPort int
	wsConnectURL   string
	wsConn         *websocket.Conn

	// For when the connection is lost
	backOffSeconds time.Duration

	receivingRequests      map[string]*io.PipeWriter
	receivingRequestsMutex sync.Mutex

	// To sequence send requests
	sendChannel chan *ResponseMessage
}

// NewTunnelConnection creates a new tunnel instance
func NewTunnelConnection(wsConnectURL string, localProxyPort int) *TunnelConnection {
	return &TunnelConnection{
		wsConnectURL:   wsConnectURL,
		localProxyPort: localProxyPort,
		backOffSeconds: 1,
	}
}

func (t *TunnelConnection) init(conn *websocket.Conn) {
	t.wsConn = conn
	t.receivingRequests = make(map[string]*io.PipeWriter)
	if t.sendChannel != nil {
		// Close
		close(t.sendChannel)
	}
	t.sendChannel = make(chan *ResponseMessage)
	t.backOffSeconds = 1
}

// Connect establishes the websocket connection and starts listening for messages
func (t *TunnelConnection) Connect() {
	for {
		// TODO: May have to finetune this
		dialer := websocket.Dialer{}
		conn, httpResp, err := dialer.Dial(t.wsConnectURL, nil)
		if err != nil {
			if httpResp.StatusCode == 401 {
				log.Printf("Failed to connect to tunnel: token rejected")
				return
			}
			log.Printf("Failed to connect to tunnel: %s, retrying in %ds", err.Error(), t.backOffSeconds)
			time.Sleep(t.backOffSeconds * time.Second)

			// Exponential back-off
			if t.backOffSeconds < 30 {
				t.backOffSeconds *= 2
			}
			continue
		}
		t.init(conn)

		log.Print("Successfully connected to tunnel.")

		// Start writer go-routine
		go t.sendPump()

		// Listen for incoming messages
		for {
			messageType, message, err := t.wsConn.ReadMessage()
			if err != nil {
				log.Printf("Error reading tunnel message: %v", err)
				// Likely this is a broken connection, eject out of this loop triggering a reconnect
				t.wsConn.Close()
				break
			}

			if messageType != websocket.BinaryMessage {
				log.Printf("Received non-binary message, skipping")
				continue
			}

			reqMsg, err := DecodeRequestMessage(message)
			if err != nil {
				log.Printf("Error decoding request message: %v", err)
				continue
			}

			// Handle the request message asynchronously
			go t.handleRequestMessage(reqMsg)
		}
		conn.Close()
	}
}

func (t *TunnelConnection) handleRequestMessage(reqMsg *RequestMessage) {
	t.receivingRequestsMutex.Lock()
	pipeWriter := t.receivingRequests[reqMsg.ID]

	if pipeWriter == nil {
		// First message - start the HTTP request
		if reqMsg.Metadata == nil {
			log.Printf("First message for request %s has no metadata", reqMsg.ID)
			t.sendErrorResponse(reqMsg.ID, "First message must contain metadata")
			t.receivingRequestsMutex.Unlock()
			return
		}

		log.Printf("Tunnel request: %s %s", reqMsg.Metadata.Method, reqMsg.Metadata.Path)

		// Create a pipe for streaming the request body
		var pipeReader *io.PipeReader
		pipeReader, pipeWriter = io.Pipe()

		t.receivingRequests[reqMsg.ID] = pipeWriter
		t.receivingRequestsMutex.Unlock()

		// Start the HTTP request in a goroutine
		go func() {
			t.streamProxyRequest(reqMsg.ID, reqMsg.Metadata, pipeReader)
			// Done, remove from receiving requests
			t.receivingRequestsMutex.Lock()
			delete(t.receivingRequests, reqMsg.ID)
			t.receivingRequestsMutex.Unlock()
		}()
	} else {
		t.receivingRequestsMutex.Unlock()
	}

	// Write the chunk to the pipe
	if _, err := pipeWriter.Write(reqMsg.Payload); err != nil {
		log.Printf("Error writing to pipe: %v", err)
		pipeWriter.CloseWithError(err)
		return
	}

	// If this is also the final message, close the pipe
	if reqMsg.IsFinal {
		pipeWriter.Close()
	}

}

func (t *TunnelConnection) streamProxyRequest(id string, metadata *RequestMetadata, body io.Reader) {
	// Build the local URL
	localURL := fmt.Sprintf("http://localhost:%d%s", t.localProxyPort, metadata.Path)

	// Create HTTP request with streaming body
	req, err := http.NewRequest(metadata.Method, localURL, body)
	if err != nil {
		log.Printf("Error creating request: %v", err)
		t.sendErrorResponse(id, fmt.Sprintf("Error creating request: %v", err))
		return
	}

	// Copy headers
	for key, value := range metadata.Headers {
		req.Header.Set(key, value)
	}

	// Execute the request
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		t.sendErrorResponse(id, fmt.Sprintf("Error executing request: %v", err))
		return
	}
	defer resp.Body.Close()

	// Stream back response
	t.streamResponse(id, resp)
}

func (t *TunnelConnection) streamResponse(id string, resp *http.Response) {
	isFirst := true
	isFinal := false

	// Build response headers map
	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[key] = values[0]
		}
	}

	for !isFinal {
		var buffer bytes.Buffer
		// Read up to ChunkSize bytes at a time
		n, err := io.Copy(&buffer, io.LimitReader(resp.Body, ChunkSize))
		if err != nil {
			log.Printf("Error reading response body: %v", err)
			t.sendErrorResponse(id, fmt.Sprintf("Error reading response body: %v", err))
			break
		}
		// When we read less, this is the final chunk
		isFinal = n < ChunkSize

		respMsg := &ResponseMessage{
			ID:      id,
			IsFinal: isFinal,
			Payload: buffer.Bytes(),
		}

		// Include metadata only in the first message
		if isFirst {
			respMsg.Metadata = &ResponseMetadata{
				StatusCode: resp.StatusCode,
				Headers:    respHeaders,
			}
			isFirst = false
		}

		t.sendChannel <- respMsg
	}
}

func (t *TunnelConnection) sendPump() {
	for respMsg := range t.sendChannel {
		// Encode
		resp, err := EncodeResponseMessage(respMsg)
		if err != nil {
			log.Printf("error encoding response message: %v", err)
		}

		// Send over websocket
		if err := t.wsConn.WriteMessage(websocket.BinaryMessage, resp); err != nil {
			log.Printf("error sending response: %s", err.Error())
			t.wsConn.Close()
			break
		}
	}
}

func (t *TunnelConnection) sendErrorResponse(id string, errorMsg string) {
	respMsg := &ResponseMessage{
		ID:      id,
		IsFinal: true,
		Metadata: &ResponseMetadata{
			StatusCode: 500,
			Headers:    map[string]string{"Content-Type": "text/plain"},
		},
		Payload: []byte(errorMsg),
	}

	t.sendChannel <- respMsg
}
