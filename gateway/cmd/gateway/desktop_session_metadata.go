package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type sessionMetadataWriter interface {
	UpsertSessionMetadata(ctx context.Context, userID, sessionID, sessionType string, upd store.SessionUpdate) (*store.ChatSession, error)
}

func desktopSessionMetadataHandler(w sessionMetadataWriter) http.HandlerFunc {
	type metadataRequest struct {
		ID            string  `json:"id"`
		Title         *string `json:"title"`
		Model         *string `json:"model"`
		WorkspacePath *string `json:"workspace_path"`
		Type          string  `json:"type"`
	}

	return func(resp http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(resp, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(resp, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req metadataRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(resp, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		sessionID := strings.TrimSpace(req.ID)
		if sessionID == "" {
			writeJSON(resp, http.StatusBadRequest, map[string]string{"error": "id is required"})
			return
		}

		sess, err := w.UpsertSessionMetadata(r.Context(), user.ID, sessionID, req.Type, store.SessionUpdate{
			Title:         req.Title,
			Model:         req.Model,
			WorkspacePath: req.WorkspacePath,
		})
		if err != nil {
			writeJSON(resp, http.StatusInternalServerError, map[string]string{"error": "failed to write session metadata"})
			return
		}

		writeJSON(resp, http.StatusOK, sess)
	}
}
