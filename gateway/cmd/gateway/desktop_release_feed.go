package main

import (
	"fmt"
	"net/http"
	"net/url"
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

		assets := pickReleaseAssetsForFeed(rel.Assets, platformFamily)
		if len(assets) == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no asset for platform"})
			return
		}

		body := buildElectronUpdaterChannelYAML(rel, assets)
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}
}

func pickReleaseAssetsForFeed(assets []store.ReleaseAsset, platformFamily string) []store.ReleaseAsset {
	var preferred []store.ReleaseAsset
	var fallback []store.ReleaseAsset

	for _, asset := range assets {
		if !assetMatchesFeedPlatform(asset.Platform, platformFamily) {
			continue
		}
		if !assetMatchesElectronUpdaterArtifact(asset.DownloadURL, platformFamily) {
			continue
		}
		if strings.TrimSpace(asset.Signature) == "" {
			continue
		}
		if isUpdaterPlatform(asset.Platform) {
			preferred = append(preferred, asset)
		} else {
			fallback = append(fallback, asset)
		}
	}

	seen := make(map[string]struct{}, len(preferred)+len(fallback))
	picked := make([]store.ReleaseAsset, 0, len(preferred)+len(fallback))
	for _, group := range [][]store.ReleaseAsset{preferred, fallback} {
		for _, asset := range group {
			key := asset.DownloadURL
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			picked = append(picked, asset)
		}
	}
	return picked
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
		return strings.Contains(p, "linux") && !strings.Contains(p, "arm") && !strings.Contains(p, "aarch64")
	case "linux-arm64":
		return strings.Contains(p, "linux") && (strings.Contains(p, "arm") || strings.Contains(p, "aarch64"))
	default:
		return false
	}
}

func isUpdaterPlatform(platform string) bool {
	return strings.HasSuffix(strings.ToLower(platform), "-updater")
}

func assetMatchesElectronUpdaterArtifact(downloadURL, family string) bool {
	fileName := strings.ToLower(releaseAssetFileName(downloadURL))
	switch family {
	case "darwin":
		return strings.HasSuffix(fileName, ".zip")
	case "win32":
		return strings.HasSuffix(fileName, ".exe")
	case "linux", "linux-arm64":
		return strings.HasSuffix(fileName, ".appimage")
	default:
		return false
	}
}

func releaseAssetFileName(downloadURL string) string {
	parsed, err := url.Parse(downloadURL)
	if err == nil && parsed.Path != "" {
		return path.Base(parsed.Path)
	}
	return path.Base(downloadURL)
}

func yamlSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func buildElectronUpdaterChannelYAML(rel *store.DesktopRelease, assets []store.ReleaseAsset) string {
	pub := rel.PubDate.UTC().Format(time.RFC3339)
	var body strings.Builder
	fmt.Fprintf(&body, "version: %s\nfiles:\n", rel.Version)
	for _, asset := range assets {
		fmt.Fprintf(&body, "  - url: %s\n    sha512: %s\n    size: %d\n",
			yamlSingleQuote(asset.DownloadURL),
			yamlSingleQuote(asset.Signature),
			asset.FileSize,
		)
	}
	first := assets[0]
	fmt.Fprintf(&body, `path: %s
sha512: %s
releaseDate: %s
`, yamlSingleQuote(first.DownloadURL), yamlSingleQuote(first.Signature), yamlSingleQuote(pub))
	return body.String()
}
