package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type stubSessionMetadataWriter struct {
	lastUserID    string
	lastSessionID string
	lastType      string
	lastUpdate    store.SessionUpdate
	result        *store.ChatSession
	err           error
}

func (s *stubSessionMetadataWriter) UpsertSessionMetadata(
	ctx context.Context,
	userID, sessionID, sessionType string,
	upd store.SessionUpdate,
) (*store.ChatSession, error) {
	s.lastUserID = userID
	s.lastSessionID = sessionID
	s.lastType = sessionType
	s.lastUpdate = upd
	if s.err != nil {
		return nil, s.err
	}
	return s.result, nil
}

func TestDesktopSessionMetadataHandler_RequiresAuth(t *testing.T) {
	t.Parallel()

	handler := desktopSessionMetadataHandler(&stubSessionMetadataWriter{})
	body := []byte(`{"id":"sess-1","title":"t"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/session-metadata", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestDesktopSessionMetadataHandler_UpsertsScopedToUser(t *testing.T) {
	t.Parallel()

	now := time.Date(2024, 7, 1, 9, 0, 0, 0, time.UTC)
	title := "New chat"
	model := "gpt-5.5"
	workspace := "/ws/root"
	stub := &stubSessionMetadataWriter{
		result: &store.ChatSession{
			ID: "craft-sess-abc", UserID: "uid-octest", Title: title, Type: "chat",
			Model: model, WorkspacePath: workspace, CreatedAt: now, UpdatedAt: now,
		},
	}
	handler := desktopSessionMetadataHandler(stub)

	payload, _ := json.Marshal(map[string]interface{}{
		"id":             "craft-sess-abc",
		"title":          title,
		"model":          model,
		"workspace_path": workspace,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/session-metadata", bytes.NewReader(payload))
	user := &auth.UserInfo{ID: "uid-octest", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if stub.lastUserID != "uid-octest" || stub.lastSessionID != "craft-sess-abc" {
		t.Fatalf("upsert scope = user %q session %q", stub.lastUserID, stub.lastSessionID)
	}
	if stub.lastUpdate.Title == nil || *stub.lastUpdate.Title != title {
		t.Fatalf("title update = %#v", stub.lastUpdate.Title)
	}
	if stub.lastUpdate.Model == nil || *stub.lastUpdate.Model != model {
		t.Fatalf("model update = %#v", stub.lastUpdate.Model)
	}
	if stub.lastUpdate.Messages != nil {
		t.Fatalf("messages must not be sent on metadata write-back: %#v", stub.lastUpdate.Messages)
	}
}

func TestDesktopSessionMetadataHandler_PartialTitleOnly(t *testing.T) {
	t.Parallel()

	stub := &stubSessionMetadataWriter{
		result: &store.ChatSession{ID: "s1", UserID: "u1", Title: "Only title"},
	}
	handler := desktopSessionMetadataHandler(stub)

	payload := []byte(`{"id":"s1","title":"Only title"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/session-metadata", bytes.NewReader(payload))
	user := &auth.UserInfo{ID: "u1", Name: "a", Email: "a@b.c", Role: "user"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if stub.lastUpdate.Model != nil || stub.lastUpdate.WorkspacePath != nil {
		t.Fatalf("expected partial update (title only), got %#v", stub.lastUpdate)
	}
}

func TestDesktopSessionMetadataHandler_RequiresId(t *testing.T) {
	t.Parallel()

	handler := desktopSessionMetadataHandler(&stubSessionMetadataWriter{})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/session-metadata", bytes.NewReader([]byte(`{"title":"x"}`)))
	user := &auth.UserInfo{ID: "u1", Name: "a", Email: "a@b.c", Role: "user"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
