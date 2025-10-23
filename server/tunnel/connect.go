package tunnel

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Tunnel struct {
	wsConnectURL     string
	localPort        int
	conn             *websocket.Conn
	inflightRequests map[string]*streamingRequest
	requestMapLock   sync.Mutex
	sendChannel      chan *ResponseMessage
	backOffSeconds   time.Duration
}

type streamingRequest struct {
	pipeWriter *io.PipeWriter
	done       chan struct{}
}

// NewTunnel creates a new tunnel instance
func NewTunnel(wsConnectURL string, port int) *Tunnel {
	return &Tunnel{
		wsConnectURL: wsConnectURL,
		localPort:    port,
	}
}

func (t *Tunnel) init(conn *websocket.Conn) {
	t.inflightRequests = make(map[string]*streamingRequest)
	t.sendChannel = make(chan *ResponseMessage)
	t.conn = conn
	t.backOffSeconds = 1
}

// Connect establishes the websocket connection and starts listening for messages
func (t *Tunnel) Connect() {
	for {
		dialer := websocket.Dialer{}
		conn, _, err := dialer.Dial(t.wsConnectURL, nil)
		if err != nil {
			log.Printf("Failed to connect to tunnel: %s, retrying in %ds", err.Error(), t.backOffSeconds)
			time.Sleep(t.backOffSeconds * time.Second)
			if t.backOffSeconds < 30 {
				t.backOffSeconds *= 2
			}
			continue
		}
		defer conn.Close()
		t.init(conn)

		log.Printf("Connected to tunnel: %s", t.wsConnectURL)

		go t.sendPump()

		// Listen for incoming messages
		for {
			messageType, message, err := t.conn.ReadMessage()
			if err != nil {
				log.Printf("Error reading tunnel message: %v", err)
				break
			}

			if messageType != websocket.BinaryMessage {
				log.Printf("Received non-binary message, skipping")
				continue
			}

			// Decompress the message
			decompressed, err := GzipDecompress(message)
			if err != nil {
				log.Printf("Error decompressing message: %v", err)
				continue
			}

			// Decode the RequestMessage using gob
			reqMsg, err := DecodeRequestMessage(decompressed)
			if err != nil {
				log.Printf("Error decoding request message: %v", err)
				continue
			}

			// Handle the request message
			go t.handleRequestMessage(reqMsg)
		}
	}
}

func (t *Tunnel) handleRequestMessage(reqMsg *RequestMessage) {
	t.requestMapLock.Lock()
	streamReq, exists := t.inflightRequests[reqMsg.ID]

	if !exists {
		// First message - start the HTTP request
		if reqMsg.Metadata == nil {
			t.requestMapLock.Unlock()
			log.Printf("First message for request %s has no metadata", reqMsg.ID)
			t.sendErrorResponse(reqMsg.ID, "First message must contain metadata")
			return
		}

		log.Printf("Got %s with %s with reqId: %s", reqMsg.Metadata.Method, reqMsg.Metadata.Path, reqMsg.ID)

		// Create a pipe for streaming the request body
		pipeReader, pipeWriter := io.Pipe()

		streamReq = &streamingRequest{
			pipeWriter: pipeWriter,
			done:       make(chan struct{}),
		}
		t.inflightRequests[reqMsg.ID] = streamReq
		t.requestMapLock.Unlock()

		// Start the HTTP request in a goroutine
		go func() {
			defer close(streamReq.done)
			t.executeStreamingRequest(reqMsg.ID, reqMsg.Metadata, pipeReader)
		}()
	}

	// Write the chunk to the pipe
	if _, err := streamReq.pipeWriter.Write(reqMsg.Payload); err != nil {
		log.Printf("Error writing to pipe: %v", err)
		streamReq.pipeWriter.CloseWithError(err)
		return
	}

	// If this is also the final message, close the pipe
	if reqMsg.IsFinal {
		streamReq.pipeWriter.Close()
		t.requestMapLock.Lock()
		delete(t.inflightRequests, reqMsg.ID)
		t.requestMapLock.Unlock()
		// Wait for the request to complete
		<-streamReq.done
		log.Printf("Request %s completed", reqMsg.ID)
	}

}

func (t *Tunnel) executeStreamingRequest(id string, metadata *RequestMetadata, body io.Reader) {
	// Build the local URL
	localURL := fmt.Sprintf("http://localhost:%d%s", t.localPort, metadata.Path)

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
	t.streamResponse(id, resp, metadata.Path)
}

func (t *Tunnel) streamResponse(id string, resp *http.Response, path string) {
	isFirst := true
	isFinal := false

	// Build response headers map
	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[key] = values[0]
		}
	}
	buffer := make([]byte, ChunkSize)

	for !isFinal {
		n, err := resp.Body.Read(buffer)
		isFinal = err == io.EOF || n == 0

		if err != nil && err != io.EOF {
			log.Printf("Error reading response body: %v", err)
			t.sendErrorResponse(id, fmt.Sprintf("Error reading response body: %v", err))
			break
		}

		respMsg := &ResponseMessage{
			ID:      id,
			IsFinal: isFinal,
			Payload: buffer[:n],
		}

		// Include metadata only in the first message
		if isFirst {
			respMsg.Metadata = &ResponseMetadata{
				StatusCode: resp.StatusCode,
				Path:       path,
				Headers:    respHeaders,
			}
			isFirst = false
		}

		t.sendChannel <- respMsg
	}
}

func (t *Tunnel) sendPump() {
	for respMsg := range t.sendChannel {
		// Encode
		resp, err := EncodeResponseMessage(respMsg)
		if err != nil {
			log.Printf("error encoding response message: %v", err)
		}

		// Compress
		compressed, err := GzipCompress(resp)
		if err != nil {
			log.Printf("error compressing response: %v", err)
		}

		// Send over websocket
		if err := t.conn.WriteMessage(websocket.BinaryMessage, compressed); err != nil {
			log.Printf("error sending response: %s", err.Error())
			t.conn.Close()
			break
		}
	}
}

func (t *Tunnel) sendErrorResponse(id string, errorMsg string) {
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
