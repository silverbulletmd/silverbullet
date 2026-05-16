package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

type OutputMode int

const (
	// OutputAuto picks Text on a TTY (or with --text), JSON otherwise.
	// Use only at flag-resolution time; FormatOutput will not see this value.
	OutputAuto OutputMode = iota
	// OutputJSON is compact JSON with a trailing newline.
	OutputJSON
	// OutputText is the human-friendly default: a string is printed verbatim;
	// a JSON array of objects renders as a kubectl-style aligned table; a
	// single JSON object renders as a two-column key/value block; anything
	// else falls back to indented JSON.
	OutputText
	// OutputTable forces table rendering. Non-tabular values render the same
	// way OutputText would.
	OutputTable
	// OutputJSONL writes one JSON value per line. Arrays are split into
	// element-per-line; non-arrays render as a single line.
	OutputJSONL
	// OutputYAML writes YAML.
	OutputYAML
)

// ResolveOutputMode determines output format from the three flag inputs and
// stdout TTY state. Precedence: --json > --text > -o > TTY autodetect.
func ResolveOutputMode(jsonFlag, textFlag bool, outputFlag string, isTTY bool) OutputMode {
	if jsonFlag {
		return OutputJSON
	}
	if textFlag {
		return OutputText
	}
	switch outputFlag {
	case "json":
		return OutputJSON
	case "text":
		return OutputText
	case "table":
		return OutputTable
	case "jsonl":
		return OutputJSONL
	case "yaml":
		return OutputYAML
	case "auto", "":
		// fall through to TTY autodetect
	}
	if isTTY {
		return OutputText
	}
	return OutputJSON
}

// FormatOutput writes result to w in the given mode. A nil result writes nothing.
func FormatOutput(w io.Writer, result any, mode OutputMode) error {
	if result == nil {
		return nil
	}
	switch mode {
	case OutputJSON:
		return writeJSONCompact(w, result)
	case OutputJSONL:
		return writeJSONL(w, result)
	case OutputYAML:
		return writeYAML(w, result)
	case OutputTable:
		return writeTable(w, result)
	case OutputText:
		if s, ok := result.(string); ok {
			return writeLine(w, s)
		}
		// Object arrays / single objects → table; otherwise indented JSON.
		switch result.(type) {
		case []any, []map[string]any, map[string]any:
			return writeTable(w, result)
		default:
			return writeJSONIndent(w, result)
		}
	default:
		return writeJSONIndent(w, result)
	}
}

// FormatOutputBytes is a convenience for callers that already have a raw JSON
// response body (e.g. proxy from an HTTP endpoint). It unmarshals into a
// generic value and delegates to FormatOutput. If the body isn't valid JSON
// it's written through verbatim.
func FormatOutputBytes(w io.Writer, body []byte, mode OutputMode) error {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		_, werr := w.Write(body)
		return werr
	}
	return FormatOutput(w, v, mode)
}

// AddOutputFlags registers persistent --json, --text and -o/--output flags
// on a Cobra command (typically the root). All subcommands inherit them.
func AddOutputFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().Bool("json", false, "Force JSON output (shortcut for -o json)")
	cmd.PersistentFlags().Bool("text", false, "Force human-readable output (shortcut for -o text)")
	cmd.PersistentFlags().StringP("output", "o", "auto", "Output format: auto|text|table|json|jsonl|yaml")
}

// OutputModeFromCmd resolves the output mode from --json, --text, --output
// flags and the stdout TTY state.
func OutputModeFromCmd(cmd *cobra.Command) OutputMode {
	jsonFlag, _ := cmd.Flags().GetBool("json")
	textFlag, _ := cmd.Flags().GetBool("text")
	outputFlag, _ := cmd.Flags().GetString("output")
	return ResolveOutputMode(jsonFlag, textFlag, outputFlag, isTerminal(os.Stdout))
}

// ---- formatters ---------------------------------------------------------

func writeLine(w io.Writer, s string) error {
	if !strings.HasSuffix(s, "\n") {
		s += "\n"
	}
	_, err := fmt.Fprint(w, s)
	return err
}

func writeJSONCompact(w io.Writer, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(b))
	return err
}

func writeJSONIndent(w io.Writer, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(b))
	return err
}

func writeJSONL(w io.Writer, v any) error {
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			line, err := json.Marshal(item)
			if err != nil {
				return err
			}
			if _, err := fmt.Fprintln(w, string(line)); err != nil {
				return err
			}
		}
		return nil
	default:
		return writeJSONCompact(w, v)
	}
}

func writeYAML(w io.Writer, v any) error {
	out, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Errorf("encoding YAML: %w", err)
	}
	_, err = w.Write(out)
	return err
}

// ---- table rendering ----------------------------------------------------

// Preferred column order for object lists. Any keys not in this list come
// after, alphabetized. Total columns capped to keep output readable.
var preferredColumns = []string{
	"tag", "ref", "name", "count",
	"done", "priority", "due",
	"page", "lastModified",
}

const maxTableColumns = 8
const maxCellWidth = 40

// writeTable renders an array of objects as an aligned column table
// (kubectl-style), or a single object as a two-column key/value block.
// Falls back to printing primitive arrays one per line, or pretty JSON
// for shapes that don't fit either.
func writeTable(w io.Writer, v any) error {
	switch t := v.(type) {
	case []any:
		return writeTableList(w, t)
	case []map[string]any:
		anys := make([]any, len(t))
		for i, r := range t {
			anys[i] = r
		}
		return writeTableList(w, anys)
	case map[string]any:
		return writeTableObject(w, t)
	default:
		return writeJSONIndent(w, v)
	}
}

func writeTableList(w io.Writer, items []any) error {
	if len(items) == 0 {
		fmt.Fprintln(os.Stderr, "(no rows)")
		return nil
	}
	rows := make([]map[string]any, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			rows = append(rows, m)
		}
	}
	if len(rows) == 0 {
		// Array of primitives — one per line.
		for _, it := range items {
			fmt.Fprintln(w, formatCell(it))
		}
		return nil
	}

	keySet := map[string]bool{}
	for _, r := range rows {
		for k := range r {
			keySet[k] = true
		}
	}
	cols := pickColumns(keySet)

	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, strings.Join(cols, "\t"))
	for _, r := range rows {
		cells := make([]string, len(cols))
		for i, c := range cols {
			cells[i] = formatCell(r[c])
		}
		fmt.Fprintln(tw, strings.Join(cells, "\t"))
	}
	return tw.Flush()
}

func writeTableObject(w io.Writer, obj map[string]any) error {
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sortKeysPreferred(keys)
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	for _, k := range keys {
		fmt.Fprintf(tw, "%s\t%s\n", k, formatCell(obj[k]))
	}
	return tw.Flush()
}

func pickColumns(keys map[string]bool) []string {
	var cols []string
	seen := map[string]bool{}
	for _, c := range preferredColumns {
		if keys[c] && !seen[c] {
			cols = append(cols, c)
			seen[c] = true
		}
		if len(cols) >= maxTableColumns {
			return cols
		}
	}
	var rest []string
	for k := range keys {
		if !seen[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	for _, k := range rest {
		if len(cols) >= maxTableColumns {
			break
		}
		cols = append(cols, k)
	}
	return cols
}

func sortKeysPreferred(keys []string) {
	rank := map[string]int{}
	for i, k := range preferredColumns {
		rank[k] = i
	}
	sort.SliceStable(keys, func(i, j int) bool {
		ri, oki := rank[keys[i]]
		rj, okj := rank[keys[j]]
		if oki && okj {
			return ri < rj
		}
		if oki {
			return true
		}
		if okj {
			return false
		}
		return keys[i] < keys[j]
	})
}

func formatCell(v any) string {
	if v == nil {
		return ""
	}
	var s string
	switch x := v.(type) {
	case string:
		s = x
	case bool, float64, int, int64:
		s = fmt.Sprintf("%v", x)
	case []any, map[string]any:
		b, _ := json.Marshal(x)
		s = string(b)
	default:
		s = fmt.Sprintf("%v", x)
	}
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) > maxCellWidth {
		runes := []rune(s)
		s = string(runes[:maxCellWidth-1]) + "…"
	}
	return s
}
