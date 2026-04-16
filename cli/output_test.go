package cli

import (
	"bytes"
	"testing"
)

func TestFormatOutput_JSON(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, map[string]any{"name": "test", "count": 3}, OutputJSON)
	if err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	// Should be compact JSON with trailing newline
	if got != `{"count":3,"name":"test"}`+"\n" {
		t.Errorf("got %q", got)
	}
}

func TestFormatOutput_Text_String(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, "hello world", OutputText)
	if err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); got != "hello world\n" {
		t.Errorf("got %q", got)
	}
}

func TestFormatOutput_Text_Slice(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, []any{"a", "b"}, OutputText)
	if err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	// Text mode for non-string types falls back to indented JSON
	expected := "[\n  \"a\",\n  \"b\"\n]\n"
	if got != expected {
		t.Errorf("got %q, want %q", got, expected)
	}
}

func TestFormatOutput_Nil(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, nil, OutputJSON)
	if err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestResolveOutputMode(t *testing.T) {
	// Explicit flags override detection
	if got := ResolveOutputMode(true, false, false); got != OutputJSON {
		t.Errorf("--json flag: got %v, want JSON", got)
	}
	if got := ResolveOutputMode(false, true, false); got != OutputText {
		t.Errorf("--text flag: got %v, want Text", got)
	}
	// Auto-detect: TTY = text, non-TTY = JSON
	if got := ResolveOutputMode(false, false, true); got != OutputText {
		t.Errorf("isTTY=true: got %v, want Text", got)
	}
	if got := ResolveOutputMode(false, false, false); got != OutputJSON {
		t.Errorf("isTTY=false: got %v, want JSON", got)
	}
}
