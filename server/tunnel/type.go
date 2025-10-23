package tunnel

import (
	"bytes"
	"encoding/gob"
)

const (
	ChunkSize = 1024 * 1024
)

type RequestMetadata struct {
	Method     string
	StatusCode int
	Path       string
	Headers    map[string]string
}

type RequestMessage struct {
	Host     string
	ID       string
	IsFinal  bool
	Metadata *RequestMetadata
	Payload  []byte
}

type ResponseMetadata struct {
	StatusCode int
	Path       string
	Headers    map[string]string
}

type ResponseMessage struct {
	ID       string
	IsFinal  bool
	Metadata *ResponseMetadata // Pointer to avoid encoding when nil
	Payload  []byte
}

func EncodeRequestMessage(msg *RequestMessage) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := gob.NewEncoder(&buffer)

	if err := encoder.Encode(msg); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

func DecodeRequestMessage(buf []byte) (*RequestMessage, error) {
	var requestMessage RequestMessage

	if err := gob.NewDecoder(bytes.NewReader(buf)).Decode(&requestMessage); err != nil {
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

	return buffer.Bytes(), nil
}

func DecodeResponseMessage(buf []byte) (*ResponseMessage, error) {
	var responseMessage ResponseMessage

	if err := gob.NewDecoder(bytes.NewReader(buf)).Decode(&responseMessage); err != nil {
		return nil, err
	}

	return &responseMessage, nil
}
