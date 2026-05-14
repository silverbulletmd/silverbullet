package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// rawRequest performs an HTTP request against the space and returns the raw body and status.
// Unlike apiGet/apiPost, it does not interpret the body or fail on non-2xx — the caller decides.
func (c *SpaceConnection) rawRequest(method, path string, body io.Reader) ([]byte, int, error) {
	headers, err := c.buildHeaders()
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header = headers
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || (resp.StatusCode >= 300 && resp.StatusCode < 400 && resp.StatusCode != 304) {
		// Don't surface auth-required as a "raw" response; emit a clear error.
		return nil, resp.StatusCode, fmt.Errorf("authentication required; use --token, or configure a space with 'space add'")
	}
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return respBody, resp.StatusCode, nil
}

func GetCommand() *cobra.Command {
	var (
		selector []string
		where    []string
		sortBy   []string
		limit    int
		offset   int
		selects  string
		verbose  bool
	)
	cmd := &cobra.Command{
		Use:   "get [tag] [ref]",
		Short: "List indexed tags, list objects of a tag, or fetch one object (kubectl-style)",
		Long: `Retrieve indexed objects.

  sb get                 # list all used tag names
  sb get <tag>           # list all objects with this tag (paged, filtered)
  sb get <tag> <ref>     # fetch one object by its ref

OBJECTS AND TAGS

Each object has a "ref" field that uniquely identifies it within its tag.
For pages, the ref is the page name; for many others, it's typically "PageName@PositionIndex".

Run 'sb describe <tag>' to see the field schema for a tag (when defined).

FILTERING (--where, -l/--selector)

  -l, --selector field=value[,field=value]
      Comma-separated equality selectors. Quickest path for AND-of-equalities.

  --where <expr>   (repeatable)
      Full operator support. Syntax: 'field=value' (equality) or 'field:OP=value'.
      Multiple --where flags are AND-ed together.

  Operators:
      eq          equal to                       --where done=false
      ne          not equal                      --where status:ne=archived
      gt          numeric/string greater than    --where priority:gt=2
      gte         greater than or equal          --where due:gte=2026-01-01
      lt          less than                      --where lineCount:lt=100
      lte         less than or equal             --where due:lte=2026-06-01
      in          value in comma-separated list  --where status:in=open,pending
      contains    string contains substring      --where name:contains=meeting
      startsWith  string starts with prefix      --where name:startsWith=2026-

  Field paths use dotted notation for nested fields:
      --where meta.author=alice

VALUE TYPING

Values are auto-typed:
  42, -3.14    -> number
  true, false  -> boolean
  null         -> nil (matches missing or explicit-null fields)
  anything else -> string

Force a type with a prefix:
      --where zipCode=str:01234         # treat as string, not number
      --where count:gt=num:10           # explicit number
      --where active=bool:true          # explicit boolean

SORTING, PAGING, PROJECTION

  --sort-by field[:desc]    (repeatable) — multi-key sort
  --limit N                 default 100, max 1000
  --offset N                pagination offset
  --select f1,f2,...        project only these fields per result

OUTPUT (global -o, --output | --text | --json)

  auto    (default) Text on a TTY (table for object lists), JSON otherwise — for humans + pipes
  text    string-as-string; arrays of objects render as a kubectl-style table; fallback to pretty JSON
  table   force table rendering (up to 8 columns, 40-char cells)
  json    pretty-printed JSON
  jsonl   one JSON value per line — friendly to xargs / line-oriented tools
  yaml    YAML

--text and --json are shortcuts for -o text / -o json.

VERBOSE (-v)

  Adds the synthesized Lua query as an X-Equivalent-Lua response header
  and includes it in stderr. Useful for understanding what the server ran.

EXIT CODES

  0   success
  1   transport / connection error
  2   API error (non-2xx other than 404)
  3   not found (404) — when fetching a single object by ref

ALSO

  sb describe <tag>        show the field schema for a tag
  sb query '<lua>'         full Lua collection query (for things REST can't express)`,
		Example: `  # List all known tag names
  sb get

  # List all tasks
  sb get task

  # Unfinished tasks, highest priority first, top 20
  sb get task -l done=false --sort-by priority:desc --limit 20
`,
		Args: cobra.RangeArgs(0, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			conn, err := connFromFlags(cmd)
			if err != nil {
				return err
			}
			// No args: list known tag names
			if len(args) == 0 {
				body, status, err := conn.rawRequest(http.MethodGet, "/.runtime/objects", nil)
				if err != nil {
					return err
				}
				if status != 200 {
					return apiError(status, body)
				}
				return FormatOutputBytes(os.Stdout, body, OutputModeFromCmd(cmd))
			}
			tag := args[0]
			// Single-object get
			if len(args) == 2 {
				p := "/.runtime/objects/" + url.PathEscape(tag) + "/" + url.PathEscape(args[1])
				body, status, err := conn.rawRequest(http.MethodGet, p, nil)
				if err != nil {
					return err
				}
				if status == 404 {
					fmt.Fprintln(os.Stderr, "Not found")
					os.Exit(3)
				}
				if status != 200 {
					return apiError(status, body)
				}
				return FormatOutputBytes(os.Stdout, body, OutputModeFromCmd(cmd))
			}

			// List
			v := url.Values{}
			for _, s := range selector {
				for _, kv := range strings.Split(s, ",") {
					eq := strings.SplitN(kv, "=", 2)
					if len(eq) != 2 {
						return fmt.Errorf("invalid -l value: %q (want field=value)", kv)
					}
					v.Add("where["+eq[0]+"]", eq[1])
				}
			}
			for _, w := range where {
				eq := strings.SplitN(w, "=", 2)
				if len(eq) != 2 {
					return fmt.Errorf("invalid --where: %q (want field=val or field:op=val)", w)
				}
				key, val := eq[0], eq[1]
				if i := strings.IndexByte(key, ':'); i > 0 {
					field, op := key[:i], key[i+1:]
					v.Add("where["+field+"]["+op+"]", val)
				} else {
					v.Add("where["+key+"]", val)
				}
			}
			for _, s := range sortBy {
				v.Add("order", s)
			}
			if limit > 0 {
				v.Set("limit", fmt.Sprintf("%d", limit))
			}
			if offset > 0 {
				v.Set("offset", fmt.Sprintf("%d", offset))
			}
			if selects != "" {
				v.Set("select", selects)
			}
			if verbose {
				v.Set("debug", "1")
			}
			p := "/.runtime/objects/" + url.PathEscape(tag)
			if encoded := v.Encode(); encoded != "" {
				p += "?" + encoded
			}
			body, status, err := conn.rawRequest(http.MethodGet, p, nil)
			if err != nil {
				return err
			}
			if status != 200 {
				return apiError(status, body)
			}
			return FormatOutputBytes(os.Stdout, body, OutputModeFromCmd(cmd))
		},
	}
	cmd.Flags().StringSliceVarP(&selector, "selector", "l", nil, "Equality selectors: field=val,field2=val2")
	cmd.Flags().StringSliceVar(&where, "where", nil, "Filter clause: field=val or field:op=val (repeatable)")
	cmd.Flags().StringSliceVar(&sortBy, "sort-by", nil, "Sort key: field or field:desc (repeatable)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Maximum number of results")
	cmd.Flags().IntVar(&offset, "offset", 0, "Pagination offset")
	cmd.Flags().StringVar(&selects, "select", "", "Comma-separated projection fields")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "Include equivalent Lua in debug output")
	return cmd
}

func apiError(status int, body []byte) error {
	var apiErr struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(body, &apiErr)
	msg := apiErr.Error
	if msg == "" {
		msg = string(body)
	}
	return fmt.Errorf("API error (HTTP %d, code=%s): %s", status, apiErr.Code, msg)
}
