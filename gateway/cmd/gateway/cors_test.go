package main

import "testing"

func TestIsAllowedOrigin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		origin string
		allow  bool
	}{
		{name: "explicit whitelist", origin: "http://localhost:1420", allow: true},
		{name: "tauri origin", origin: "tauri://localhost", allow: true},
		{name: "localhost dynamic port", origin: "http://localhost:5173", allow: true},
		{name: "localhost https", origin: "https://localhost:7443", allow: true},
		{name: "loopback ipv4", origin: "http://127.0.0.1:3000", allow: true},
		{name: "loopback ipv6", origin: "http://[::1]:3000", allow: true},
		{name: "external host denied", origin: "https://example.com", allow: false},
		{name: "invalid origin denied", origin: "not-a-url", allow: false},
		{name: "empty origin denied", origin: "", allow: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isAllowedOrigin(tt.origin); got != tt.allow {
				t.Fatalf("isAllowedOrigin(%q) = %v, want %v", tt.origin, got, tt.allow)
			}
		})
	}
}
