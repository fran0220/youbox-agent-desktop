package main

import (
	"context"
	"net/http"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type desktopReleaseReader interface {
	GetLatestDesktopRelease(ctx context.Context) (*store.DesktopRelease, error)
}

func buildDesktopReleaseResponse(rel *store.DesktopRelease) map[string]interface{} {
	assets := make([]map[string]interface{}, 0, len(rel.Assets))
	for _, a := range rel.Assets {
		entry := map[string]interface{}{
			"platform":     a.Platform,
			"download_url": a.DownloadURL,
			"file_size":    a.FileSize,
		}
		if a.Signature != "" {
			entry["signature"] = a.Signature
		}
		assets = append(assets, entry)
	}
	return map[string]interface{}{
		"version":  rel.Version,
		"notes":    rel.Notes,
		"pub_date": rel.PubDate,
		"assets":   assets,
	}
}

func desktopReleaseLatestHandler(r desktopReleaseReader) http.HandlerFunc {
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

		rel, err := r.GetLatestDesktopRelease(req.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load release"})
			return
		}
		if rel == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no release found"})
			return
		}

		writeJSON(w, http.StatusOK, buildDesktopReleaseResponse(rel))
	}
}
