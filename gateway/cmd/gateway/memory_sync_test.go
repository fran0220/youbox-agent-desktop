package main

import (
	"encoding/json"
	"testing"
)

type memorySyncPullEntry struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Checksum string `json:"checksum"`
}

func TestMemorySyncResponseJSONEmptySlicesAreArraysNotNull(t *testing.T) {
	t.Parallel()

	resp := struct {
		Pull         []memorySyncPullEntry `json:"pull"`
		PushAccepted []string              `json:"push_accepted"`
		ServerTime   string                `json:"server_time"`
	}{
		Pull:         make([]memorySyncPullEntry, 0),
		PushAccepted: make([]string, 0),
		ServerTime:   "2026-01-01T00:00:00Z",
	}

	raw, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for _, field := range []string{"pull", "push_accepted"} {
		val, ok := decoded[field]
		if !ok {
			t.Fatalf("missing field %q in %s", field, string(raw))
		}
		if string(val) == "null" {
			t.Fatalf("field %q marshaled as null; want []", field)
		}
		if val[0] != '[' {
			t.Fatalf("field %q = %s; want JSON array", field, string(val))
		}
	}
}
