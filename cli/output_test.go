package cli

import (
	"bytes"
	"strings"
	"testing"
)

func TestFormatOutput_JSON(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, map[string]any{"name": "test", "count": 3}, OutputJSON)
	if err != nil {
		t.Fatal(err)
	}
	got := buf.String()
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

func TestFormatOutput_Text_StringSlice(t *testing.T) {
	// String arrays render one-per-line in Text mode (via table path).
	var buf bytes.Buffer
	err := FormatOutput(&buf, []any{"a", "b"}, OutputText)
	if err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); got != "a\nb\n" {
		t.Errorf("got %q", got)
	}
}

func TestFormatOutput_Text_ObjectSlice(t *testing.T) {
	// Arrays of objects render as a kubectl-style table.
	var buf bytes.Buffer
	err := FormatOutput(&buf, []any{
		map[string]any{"name": "alice", "count": 3},
		map[string]any{"name": "bob", "count": 7},
	}, OutputText)
	if err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	for _, want := range []string{"name", "count", "alice", "bob"} {
		if !strings.Contains(got, want) {
			t.Errorf("table missing %q in %q", want, got)
		}
	}
}

func TestFormatOutput_JSONL(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, []any{
		map[string]any{"x": 1},
		map[string]any{"x": 2},
	}, OutputJSONL)
	if err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); got != "{\"x\":1}\n{\"x\":2}\n" {
		t.Errorf("got %q", got)
	}
}

func TestFormatOutput_YAML(t *testing.T) {
	var buf bytes.Buffer
	err := FormatOutput(&buf, map[string]any{"name": "alice"}, OutputYAML)
	if err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); got != "name: alice\n" {
		t.Errorf("got %q", got)
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
	// Explicit --json beats everything.
	if got := ResolveOutputMode(true, false, "table", false); got != OutputJSON {
		t.Errorf("--json flag: got %v, want JSON", got)
	}
	// --text beats -o and TTY.
	if got := ResolveOutputMode(false, true, "json", false); got != OutputText {
		t.Errorf("--text flag: got %v, want Text", got)
	}
	// -o values map through.
	cases := []struct {
		flag string
		want OutputMode
	}{
		{"json", OutputJSON},
		{"text", OutputText},
		{"table", OutputTable},
		{"jsonl", OutputJSONL},
		{"yaml", OutputYAML},
	}
	for _, c := range cases {
		if got := ResolveOutputMode(false, false, c.flag, false); got != c.want {
			t.Errorf("-o %s: got %v, want %v", c.flag, got, c.want)
		}
	}
	// auto + TTY = Text; auto + no TTY = JSON.
	if got := ResolveOutputMode(false, false, "auto", true); got != OutputText {
		t.Errorf("auto+TTY: got %v, want Text", got)
	}
	if got := ResolveOutputMode(false, false, "auto", false); got != OutputJSON {
		t.Errorf("auto+noTTY: got %v, want JSON", got)
	}
}

