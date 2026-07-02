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
				{Platform: "darwin-aarch64-updater", DownloadURL: "https://cdn.example.com/releases/v1.11.1/darwin-aarch64/OriginAI-arm64.zip", FileSize: 100, Signature: "sig512"},
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
	if !strings.Contains(body, "https://cdn.example.com/releases/v1.11.1/darwin-aarch64/OriginAI-arm64.zip") {
		t.Fatalf("missing artifact url in yaml: %s", body)
	}
}

func TestAssetMatchesFeedPlatform_DarwinAarch64(t *testing.T) {
	t.Parallel()
	if !assetMatchesFeedPlatform("darwin-aarch64", "darwin") {
		t.Fatal("darwin-aarch64 should match darwin feed")
	}
}

func TestAssetMatchesFeedPlatform_LinuxAarch64OnlyMatchesArm64Feed(t *testing.T) {
	t.Parallel()
	if assetMatchesFeedPlatform("linux-aarch64-updater", "linux") {
		t.Fatal("linux-aarch64 should not match x64 linux feed")
	}
	if !assetMatchesFeedPlatform("linux-aarch64-updater", "linux-arm64") {
		t.Fatal("linux-aarch64 should match arm64 linux feed")
	}
}

func TestBuildElectronUpdaterChannelYAML(t *testing.T) {
	t.Parallel()
	pub := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	rel := &store.DesktopRelease{Version: "2.0.0", PubDate: pub}
	assets := []store.ReleaseAsset{{DownloadURL: "https://x/y/app.zip", FileSize: 42, Signature: "abc"}}
	yml := buildElectronUpdaterChannelYAML(rel, assets)
	if !strings.Contains(yml, "version: 2.0.0") || !strings.Contains(yml, "https://x/y/app.zip") {
		t.Fatalf("unexpected yaml: %s", yml)
	}
}

func TestPickReleaseAssetsForFeed_MacPrefersSignedUpdaterZips(t *testing.T) {
	t.Parallel()
	assets := []store.ReleaseAsset{
		{Platform: "darwin-aarch64", DownloadURL: "https://cdn.example.com/OriginAI-arm64.dmg", FileSize: 10, Signature: ""},
		{Platform: "darwin-aarch64-updater", DownloadURL: "https://cdn.example.com/OriginAI-arm64.zip", FileSize: 11, Signature: "sha-arm64"},
		{Platform: "darwin-x86_64-updater", DownloadURL: "https://cdn.example.com/OriginAI-x64.zip", FileSize: 12, Signature: "sha-x64"},
		{Platform: "windows-x86_64-updater", DownloadURL: "https://cdn.example.com/OriginAI-x64.exe", FileSize: 13, Signature: "sha-win"},
	}

	picked := pickReleaseAssetsForFeed(assets, "darwin")
	if len(picked) != 2 {
		t.Fatalf("picked len = %d, want 2: %#v", len(picked), picked)
	}
	yml := buildElectronUpdaterChannelYAML(&store.DesktopRelease{Version: "3.0.0", PubDate: time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)}, picked)
	for _, want := range []string{"OriginAI-arm64.zip", "sha-arm64", "OriginAI-x64.zip", "sha-x64"} {
		if !strings.Contains(yml, want) {
			t.Fatalf("yaml missing %q: %s", want, yml)
		}
	}
	if strings.Contains(yml, ".dmg") || strings.Contains(yml, "AAAAAAAA") {
		t.Fatalf("yaml should not contain installer DMG or placeholder checksum: %s", yml)
	}
}

func TestPickReleaseAssetsForFeed_SkipsUnsignedAndWrongUpdaterArtifacts(t *testing.T) {
	t.Parallel()
	assets := []store.ReleaseAsset{
		{Platform: "windows-x86_64-updater", DownloadURL: "https://cdn.example.com/OriginAI-x64.nsis.zip", FileSize: 10, Signature: "sha-zip"},
		{Platform: "windows-x86_64", DownloadURL: "https://cdn.example.com/OriginAI-x64.exe", FileSize: 11, Signature: ""},
		{Platform: "windows-x86_64-updater", DownloadURL: "https://cdn.example.com/OriginAI-x64.exe", FileSize: 12, Signature: "sha-exe"},
	}

	picked := pickReleaseAssetsForFeed(assets, "win32")
	if len(picked) != 1 {
		t.Fatalf("picked len = %d, want 1: %#v", len(picked), picked)
	}
	if picked[0].DownloadURL != "https://cdn.example.com/OriginAI-x64.exe" || picked[0].Signature != "sha-exe" {
		t.Fatalf("unexpected picked asset: %#v", picked[0])
	}
}
