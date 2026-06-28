package main

import (
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

// electron-updater generic provider channel files: latest.yml, latest-mac.yml, latest-linux.yml, latest-linux-arm64.yml
var desktopReleaseFeedChannelFiles = map[string]string{
	"latest.yml":             "win32",
	"latest-mac.yml":         "darwin",
	"latest-linux.yml":       "linux",
	"latest-linux-arm64.yml": "linux-arm64",
}

func desktopReleaseFeedHandler(r desktopReleaseReader) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		user := auth.GetUser(req.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		channelFile := strings.TrimPrefix(req.URL.Path, "/api/desktop/release/")
		if channelFile == "" || strings.Contains(channelFile, "/") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		platformFamily, ok := desktopReleaseFeedChannelFiles[channelFile]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown update channel"})
			return
		}

		rel, err := r.GetLatestDesktopRelease(req.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load release"})
			return
		}
		if rel == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no release found"})
			return
		}

		asset := pickReleaseAssetForFeed(rel.Assets, platformFamily)
		if asset == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no asset for platform"})
			return
		}

		body := buildElectronUpdaterChannelYAML(rel, *asset)
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}
}

func pickReleaseAssetForFeed(assets []store.ReleaseAsset, platformFamily string) *store.ReleaseAsset {
	for i := range assets {
		a := &assets[i]
		if assetMatchesFeedPlatform(a.Platform, platformFamily) {
			return a
		}
	}
	return nil
}

func assetMatchesFeedPlatform(platform, family string) bool {
	p := strings.ToLower(platform)
	switch family {
	case "darwin":
		return strings.Contains(p, "darwin") || strings.HasPrefix(p, "mac") ||
			(strings.Contains(p, "aarch64") && !strings.Contains(p, "linux") && !strings.Contains(p, "windows"))
	case "win32":
		return strings.Contains(p, "win") || strings.Contains(p, "windows")
	case "linux":
		return strings.Contains(p, "linux") && !strings.Contains(p, "arm")
	case "linux-arm64":
		return strings.Contains(p, "linux") && (strings.Contains(p, "arm") || strings.Contains(p, "aarch64"))
	default:
		return false
	}
}

func buildElectronUpdaterChannelYAML(rel *store.DesktopRelease, asset store.ReleaseAsset) string {
	fileName := path.Base(asset.DownloadURL)
	if fileName == "" || fileName == "." || fileName == "/" {
		fileName = "update-" + rel.Version + ".zip"
	}
	sha512 := asset.Signature
	if sha512 == "" {
		// electron-updater requires sha512 or sha2 on each file; placeholder until publish pipeline fills signatures.
		sha512 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
	}
	pub := rel.PubDate.UTC().Format(time.RFC3339)
	return fmt.Sprintf(`version: %s
files:
  - url: %s
    sha512: %s
    size: %d
path: %s
sha512: %s
releaseDate: '%s'
`, rel.Version, fileName, sha512, asset.FileSize, fileName, sha512, pub)
}
