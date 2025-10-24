package tunnel

import (
	"bytes"
	"compress/gzip"
	"encoding/gob"
	"io"
)

const (
	ChunkSize = 100 * 1024
)

type RequestMetadata struct {
	Method  string
	Path    string
	Headers map[string]string
}

// Represents a HTTP request stream (can be multiple messages)
type RequestMessage struct {
	ID   string
	Host string
	// Set to true for the last message in the stream
	IsFinal bool
	// Set only for the first message in the stream
	Metadata *RequestMetadata
	Payload  []byte
}

type ResponseMetadata struct {
	StatusCode int
	Headers    map[string]string
}

// Represents a HTTP response stream
type ResponseMessage struct {
	// The ID of the http request this is a response is a part of
	ID string
	// Set to true if this is the final message in the stream
	IsFinal bool
	// Only set for the first message
	Metadata *ResponseMetadata // Pointer to avoid encoding when nil
	Payload  []byte
}

// gob encodes and gzips a message for transmission
func EncodeRequestMessage(msg *RequestMessage) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := gob.NewEncoder(&buffer)

	if err := encoder.Encode(msg); err != nil {
		return nil, err
	}

	return gzipCompress(buffer.Bytes())
}

// gzip uncompresses and gob decodes a message from transmission
func DecodeRequestMessage(buf []byte) (*RequestMessage, error) {
	decompressed, err := gzipDecompress(buf)
	if err != nil {
		return nil, err
	}

	var requestMessage RequestMessage
	if err := gob.NewDecoder(bytes.NewReader(decompressed)).Decode(&requestMessage); err != nil {
		return nil, err
	}

	return &requestMessage, nil
}

func EncodeResponseMessage(msg *ResponseMessage) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := gob.NewEncoder(&buffer)

	if err := encoder.Encode(msg); err != nil {
		return nil, err
	}

	return gzipCompress(buffer.Bytes())
}

func DecodeResponseMessage(buf []byte) (*ResponseMessage, error) {
	decompressed, err := gzipDecompress(buf)
	if err != nil {
		return nil, err
	}

	var responseMessage ResponseMessage

	if err := gob.NewDecoder(bytes.NewReader(decompressed)).Decode(&responseMessage); err != nil {
		return nil, err
	}

	return &responseMessage, nil
}

func gzipCompress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func gzipDecompress(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return []byte{}, nil
	}

	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()

	var out bytes.Buffer
	if _, err := io.Copy(&out, r); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
