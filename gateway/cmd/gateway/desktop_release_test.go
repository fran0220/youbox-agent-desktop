package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type stubReleaseReader struct {
	release *store.DesktopRelease
	err     error
	calls   int
}

func (s *stubReleaseReader) GetLatestDesktopRelease(ctx context.Context) (*store.DesktopRelease, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return s.release, nil
}

func TestDesktopReleaseLatestHandler_RequiresAuth(t *testing.T) {
	t.Parallel()

	handler := desktopReleaseLatestHandler(&stubReleaseReader{
		release: &store.DesktopRelease{Version: "1.0.0"},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/desktop/release/latest", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestDesktopReleaseLatestHandler_ReturnsReleaseJSON(t *testing.T) {
	t.Parallel()

	pub := time.Date(2026, 6, 4, 9, 17, 50, 0, time.UTC)
	reader := &stubReleaseReader{
		release: &store.DesktopRelease{
			Version: "1.11.1",
			Notes:   "Bug fixes",
			PubDate: pub,
			Assets: []store.ReleaseAsset{
				{Platform: "darwin-aarch64", DownloadURL: "https://example.com/app.dmg", FileSize: 100, Signature: "sig"},
				{Platform: "windows-x86_64", DownloadURL: "https://example.com/app.exe", FileSize: 200},
			},
		},
	}
	handler := desktopReleaseLatestHandler(reader)

	req := httptest.NewRequest(http.MethodGet, "/api/desktop/release/latest", nil)
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	if reader.calls != 1 {
		t.Fatalf("GetLatestDesktopRelease calls = %d, want 1", reader.calls)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, rec.Body.String())
	}
	if parsed["version"] != "1.11.1" {
		t.Fatalf("version = %v", parsed["version"])
	}
	assets, ok := parsed["assets"].([]interface{})
	if !ok || len(assets) != 2 {
		t.Fatalf("assets = %#v, want 2 entries", parsed["assets"])
	}
	a0, ok := assets[0].(map[string]interface{})
	if !ok {
		t.Fatalf("assets[0] type = %T", assets[0])
	}
	for _, key := range []string{"platform", "download_url"} {
		if _, ok := a0[key]; !ok {
			t.Fatalf("missing %q in asset: %#v", key, a0)
		}
	}
}

func TestDesktopReleaseLatestHandler_NotFoundWhenNoRelease(t *testing.T) {
	t.Parallel()

	handler := desktopReleaseLatestHandler(&stubReleaseReader{release: nil})
	req := httptest.NewRequest(http.MethodGet, "/api/desktop/release/latest", nil)
	user := &auth.UserInfo{ID: "u1", Name: "octest", Role: "user"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestBuildDesktopReleaseResponse_DeterministicShape(t *testing.T) {
	t.Parallel()

	pub := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	body := buildDesktopReleaseResponse(&store.DesktopRelease{
		Version: "2.0.0",
		Notes:   "notes",
		PubDate: pub,
		Assets: []store.ReleaseAsset{
			{Platform: "linux-x86_64", DownloadURL: "https://cdn.example/linux", FileSize: 42},
		},
	})
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var again map[string]interface{}
	if err := json.Unmarshal(raw, &again); err != nil {
		t.Fatalf("unmarshal round-trip: %v", err)
	}
	if again["version"] != "2.0.0" {
		t.Fatalf("version = %v", again["version"])
	}
}
