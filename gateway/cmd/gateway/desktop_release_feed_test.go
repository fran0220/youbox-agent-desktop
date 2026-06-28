package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

func TestDesktopReleaseFeedHandler_RequiresAuth(t *testing.T) {
	t.Parallel()
	handler := desktopReleaseFeedHandler(&stubReleaseReader{
		release: &store.DesktopRelease{Version: "1.0.0"},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/desktop/release/latest-mac.yml", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestDesktopReleaseFeedHandler_ReturnsYAML(t *testing.T) {
	t.Parallel()
	pub := time.Date(2026, 6, 4, 9, 17, 50, 0, time.UTC)
	reader := &stubReleaseReader{
		release: &store.DesktopRelease{
			Version: "1.11.1",
			Notes:   "fixes",
			PubDate: pub,
			Assets: []store.ReleaseAsset{
				{Platform: "darwin-aarch64", DownloadURL: "https://cdn.example.com/OriginCoworks-Next-arm64.zip", FileSize: 100, Signature: "sig512"},
			},
		},
	}
	handler := desktopReleaseFeedHandler(reader)
	req := httptest.NewRequest(http.MethodGet, "/api/desktop/release/latest-mac.yml", nil)
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "octest@local.test", Role: "admin"}
	req = req.WithContext(context.WithValue(req.Context(), auth.UserContextKey, user))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "yaml") {
		t.Fatalf("Content-Type = %q", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "version: 1.11.1") {
		t.Fatalf("missing version in yaml: %s", body)
	}
	if !strings.Contains(body, "OriginCoworks-Next-arm64.zip") {
		t.Fatalf("missing artifact url in yaml: %s", body)
	}
}

func TestAssetMatchesFeedPlatform_DarwinAarch64(t *testing.T) {
	t.Parallel()
	if !assetMatchesFeedPlatform("darwin-aarch64", "darwin") {
		t.Fatal("darwin-aarch64 should match darwin feed")
	}
}

func TestBuildElectronUpdaterChannelYAML(t *testing.T) {
	t.Parallel()
	pub := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	rel := &store.DesktopRelease{Version: "2.0.0", PubDate: pub}
	asset := store.ReleaseAsset{DownloadURL: "https://x/y/app.zip", FileSize: 42, Signature: "abc"}
	yml := buildElectronUpdaterChannelYAML(rel, asset)
	if !strings.Contains(yml, "version: 2.0.0") || !strings.Contains(yml, "app.zip") {
		t.Fatalf("unexpected yaml: %s", yml)
	}
}
