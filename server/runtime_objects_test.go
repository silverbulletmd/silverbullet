package server

import (
	"net/url"
	"reflect"
	"sort"
	"testing"
)

func TestSplitObjectsPath(t *testing.T) {
	cases := []struct {
		in            string
		wantTag, wantRef string
		wantErr          bool
	}{
		{"page", "page", "", false},
		{"page/index", "page", "index", false},
		// Tag with slash: encoded as %2F, must round-trip as one segment.
		{"meta%2Flibrary", "meta/library", "", false},
		{"meta%2Flibrary/Some%20Page", "meta/library", "Some Page", false},
		// Ref containing %2F decodes to a single ref with `/` in it.
		{"task/Daily%2F2026-05-14%40L3", "task", "Daily/2026-05-14@L3", false},
		// Empty / bad percent escape
		{"", "", "", false}, // empty: caller will reject empty tag
		{"%ZZ/x", "", "", true},
	}
	for _, c := range cases {
		gotTag, gotRef, err := splitObjectsPath(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("%q: expected error", c.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: unexpected error %v", c.in, err)
			continue
		}
		if gotTag != c.wantTag || gotRef != c.wantRef {
			t.Errorf("%q: got (%q, %q) want (%q, %q)", c.in, gotTag, gotRef, c.wantTag, c.wantRef)
		}
	}
}

func sortFilters(in []Filter) []Filter {
	out := append([]Filter(nil), in...)
	sort.Slice(out, func(i, j int) bool { return out[i].Field < out[j].Field })
	return out
}

func TestParseObjectsQuery_Empty(t *testing.T) {
	q, err := parseObjectsQuery(url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	if q.Limit != 100 || q.Offset != 0 || len(q.Filters) != 0 {
		t.Fatalf("unexpected defaults: %+v", q)
	}
}

func TestParseObjectsQuery_WhereVariants(t *testing.T) {
	v := url.Values{}
	v.Add("where[name]", "foo")
	v.Add("where[age][gte]", "10")
	v.Add("where[status][in]", "open,pending")
	v.Add("order", "name")
	v.Add("order", "age:desc")
	v.Add("limit", "20")
	v.Add("offset", "5")
	v.Add("select", "name,age")
	q, err := parseObjectsQuery(v)
	if err != nil {
		t.Fatal(err)
	}
	want := []Filter{
		{Field: "name", Op: "eq", Value: "foo"},
		{Field: "age", Op: "gte", Value: "10"},
		{Field: "status", Op: "in", Value: "open,pending"},
	}
	if !reflect.DeepEqual(sortFilters(q.Filters), sortFilters(want)) {
		t.Fatalf("filters: got %+v want %+v", q.Filters, want)
	}
	if q.Limit != 20 || q.Offset != 5 {
		t.Fatalf("paging: %+v", q)
	}
	if len(q.Order) != 2 || q.Order[0].Field != "name" || q.Order[1].Desc != true {
		t.Fatalf("order: %+v", q.Order)
	}
	if !reflect.DeepEqual(q.Select, []string{"name", "age"}) {
		t.Fatalf("select: %+v", q.Select)
	}
}

func TestParseObjectsQuery_Errors(t *testing.T) {
	cases := []url.Values{
		{"limit": {"abc"}},
		{"limit": {"-1"}},
		{"limit": {"1001"}},
		{"offset": {"-1"}},
		{"where[bad name]": {"v"}},
		{"where[f][nope]": {"v"}},
	}
	for _, c := range cases {
		if _, err := parseObjectsQuery(c); err == nil {
			t.Errorf("expected error for %v", c)
		}
	}
}
