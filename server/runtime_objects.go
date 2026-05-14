package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Error codes returned by the /.runtime/objects/* endpoints. Kept in one
// place so backend, handler, and HTTP-status mapping stay in sync.
const (
	codeNotFound          = "not_found"
	codeUnknownTag        = "unknown_tag"
	codeBadField          = "bad_field"
	codeBadQuery          = "bad_query"
	codeUnknownOperator   = "unknown_operator"
	codeBadLimit          = "bad_limit"
	codeBridgeUnavailable = "bridge_unavailable"
	codeTimeout           = "timeout"
	codeInternal          = "internal_error"
)

// parseErr is a typed parser error so callers don't have to parse error
// strings back out.
type parseErr struct {
	Code string
	Msg  string
}

func (e parseErr) Error() string { return e.Code + ": " + e.Msg }

// Filter is one REST query filter clause.
type Filter struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value string `json:"value"`
}

// OrderKey is one sort key.
type OrderKey struct {
	Field string `json:"field"`
	Desc  bool   `json:"desc"`
}

// ObjectsListQuery is the parsed query for GET /.runtime/objects/{tag}.
type ObjectsListQuery struct {
	Filters []Filter   `json:"filters"`
	Order   []OrderKey `json:"order"`
	Limit   int        `json:"limit"`
	Offset  int        `json:"offset"`
	Select  []string   `json:"select,omitempty"`
	Debug   bool       `json:"debug,omitempty"`
}

var (
	fieldPathRe  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`)
	whereParamRe = regexp.MustCompile(`^where\[([^\]]+)\](?:\[([^\]]+)\])?$`)
	allowedOps   = map[string]struct{}{
		"eq": {}, "ne": {}, "gt": {}, "gte": {}, "lt": {}, "lte": {},
		"in": {}, "contains": {}, "startsWith": {},
	}
)

const (
	defaultLimit = 100
	maxLimit     = 1000
)

// parseObjectsQuery extracts an ObjectsListQuery from URL values.
func parseObjectsQuery(v url.Values) (ObjectsListQuery, error) {
	// Always initialize Filters/Order to non-nil empty slices so that the
	// JSON envelope sent across the bridge has `[]` rather than `null` —
	// the TS side does `.map(...)` on these fields unconditionally.
	q := ObjectsListQuery{
		Limit:   defaultLimit,
		Filters: []Filter{},
		Order:   []OrderKey{},
	}

	for key, vals := range v {
		m := whereParamRe.FindStringSubmatch(key)
		if m == nil {
			continue
		}
		field, op := m[1], m[2]
		if op == "" {
			op = "eq"
		}
		if !fieldPathRe.MatchString(field) {
			return q, parseErr{codeBadField, fmt.Sprintf("%q is not a valid field path", field)}
		}
		if _, ok := allowedOps[op]; !ok {
			return q, parseErr{codeUnknownOperator, fmt.Sprintf("%q", op)}
		}
		for _, val := range vals {
			q.Filters = append(q.Filters, Filter{Field: field, Op: op, Value: val})
		}
	}

	for _, raw := range v["order"] {
		field, desc := raw, false
		if i := strings.IndexByte(raw, ':'); i > 0 {
			field = raw[:i]
			switch raw[i+1:] {
			case "asc":
				desc = false
			case "desc":
				desc = true
			default:
				return q, parseErr{codeBadQuery, fmt.Sprintf("order direction must be asc|desc, got %q", raw[i+1:])}
			}
		}
		if !fieldPathRe.MatchString(field) {
			return q, parseErr{codeBadField, fmt.Sprintf("%q is not a valid field path", field)}
		}
		q.Order = append(q.Order, OrderKey{Field: field, Desc: desc})
	}

	if s := v.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 || n > maxLimit {
			return q, parseErr{codeBadLimit, fmt.Sprintf("limit must be 1..%d", maxLimit)}
		}
		q.Limit = n
	}
	if s := v.Get("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			return q, parseErr{codeBadQuery, "offset must be >= 0"}
		}
		q.Offset = n
	}
	if s := v.Get("select"); s != "" {
		for _, f := range strings.Split(s, ",") {
			f = strings.TrimSpace(f)
			if !fieldPathRe.MatchString(f) {
				return q, parseErr{codeBadField, fmt.Sprintf("%q is not a valid field path", f)}
			}
			q.Select = append(q.Select, f)
		}
	}
	if v.Get("debug") == "1" {
		q.Debug = true
	}
	return q, nil
}

type objectsResponse struct {
	OK            bool            `json:"ok"`
	Items         json.RawMessage `json:"items,omitempty"`
	Item          json.RawMessage `json:"item,omitempty"`
	EquivalentLua *string         `json:"equivalentLua,omitempty"`
	Error         string          `json:"error,omitempty"`
	Code          string          `json:"code,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": msg, "code": code})
}

func errorStatus(code string) int {
	switch code {
	case codeNotFound, codeUnknownTag:
		return http.StatusNotFound
	case codeBadField, codeBadQuery, codeUnknownOperator, codeBadLimit:
		return http.StatusBadRequest
	case codeBridgeUnavailable:
		return http.StatusServiceUnavailable
	case codeTimeout:
		return http.StatusGatewayTimeout
	default:
		return http.StatusInternalServerError
	}
}

func (b *RuntimeBridge) callObjectsAPI(ctx context.Context, browser *HeadlessBrowser, req any) (objectsResponse, error) {
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return objectsResponse{}, err
	}
	raw, err := browser.evalViaGlobal(ctx, "sbRuntime.objectsAPI", string(reqJSON))
	if err != nil {
		return objectsResponse{}, err
	}
	s, ok := raw.(string)
	if !ok {
		return objectsResponse{}, fmt.Errorf("unexpected bridge return type %T", raw)
	}
	var resp objectsResponse
	if err := json.Unmarshal([]byte(s), &resp); err != nil {
		return objectsResponse{}, err
	}
	return resp, nil
}

// HandleObjectsListTags handles GET /.runtime/objects.
func (b *RuntimeBridge) HandleObjectsListTags(w http.ResponseWriter, r *http.Request) {
	res, ok := b.withBridge(w, r, func(ctx context.Context, browser *HeadlessBrowser) (any, error) {
		return b.callObjectsAPI(ctx, browser, map[string]any{"kind": "list_tags"})
	})
	if !ok {
		return
	}
	resp := res.(objectsResponse)
	if !resp.OK {
		writeError(w, errorStatus(resp.Code), resp.Code, resp.Error)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(resp.Items)
}

// splitObjectsPath parses the encoded path suffix after /.runtime/objects/
// into (tag, ref). Tags or refs containing `/` must be percent-encoded
// (`%2F`); we split on the first un-encoded `/` and then decode. Returns
// ("", "", err) if either segment has an invalid percent escape.
func splitObjectsPath(escapedSuffix string) (tag, ref string, err error) {
	rawTag, rawRef, hasRef := strings.Cut(escapedSuffix, "/")
	tag, err = url.PathUnescape(rawTag)
	if err != nil {
		return "", "", fmt.Errorf("invalid tag encoding: %w", err)
	}
	if hasRef {
		ref, err = url.PathUnescape(rawRef)
		if err != nil {
			return "", "", fmt.Errorf("invalid ref encoding: %w", err)
		}
	}
	return tag, ref, nil
}

// HandleObjectsByPath routes /.runtime/objects/{tag}[/{ref}] to either the
// list or get handler. A wildcard route plus manual percent-decoding lets
// tags and refs contain `/` characters (encoded as `%2F` on the wire).
func (b *RuntimeBridge) HandleObjectsByPath(w http.ResponseWriter, r *http.Request) {
	suffix := strings.TrimPrefix(r.URL.EscapedPath(), "/.runtime/objects/")
	tag, ref, err := splitObjectsPath(suffix)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadQuery, err.Error())
		return
	}
	if tag == "" {
		writeError(w, http.StatusBadRequest, codeBadQuery, "missing tag")
		return
	}
	if ref == "" {
		b.handleObjectsList(w, r, tag)
		return
	}
	b.handleObjectsGet(w, r, tag, ref)
}

func (b *RuntimeBridge) handleObjectsList(w http.ResponseWriter, r *http.Request, tag string) {
	q, err := parseObjectsQuery(r.URL.Query())
	if err != nil {
		pe := err.(parseErr)
		writeError(w, errorStatus(pe.Code), pe.Code, pe.Msg)
		return
	}
	req := map[string]any{
		"kind":    "list",
		"tag":     tag,
		"filters": q.Filters,
		"order":   q.Order,
		"limit":   q.Limit,
		"offset":  q.Offset,
		"debug":   q.Debug,
	}
	if len(q.Select) > 0 {
		req["select"] = q.Select
	}
	res, ok := b.withBridge(w, r, func(ctx context.Context, browser *HeadlessBrowser) (any, error) {
		return b.callObjectsAPI(ctx, browser, req)
	})
	if !ok {
		return
	}
	resp := res.(objectsResponse)
	if !resp.OK {
		writeError(w, errorStatus(resp.Code), resp.Code, resp.Error)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if q.Debug && resp.EquivalentLua != nil {
		w.Header().Set("X-Equivalent-Lua", *resp.EquivalentLua)
	}
	w.Write(resp.Items)
}

func (b *RuntimeBridge) handleObjectsGet(w http.ResponseWriter, r *http.Request, tag, ref string) {
	req := map[string]any{"kind": "get", "tag": tag, "ref": ref}
	res, ok := b.withBridge(w, r, func(ctx context.Context, browser *HeadlessBrowser) (any, error) {
		return b.callObjectsAPI(ctx, browser, req)
	})
	if !ok {
		return
	}
	resp := res.(objectsResponse)
	if !resp.OK {
		writeError(w, errorStatus(resp.Code), resp.Code, resp.Error)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(resp.Item)
}

