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

type stubSessionLister struct {
	sessions []store.SessionSummary
	listErr  error
	lastUID  string
}

func (s *stubSessionLister) ListSessions(ctx context.Context, userID string) ([]store.SessionSummary, error) {
	s.lastUID = userID
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.sessions, nil
}

func TestClassicSessionsHandler_RequiresAuth(t *testing.T) {
	t.Parallel()

	handler := classicSessionsHandler(&stubSessionLister{})
	req := httptest.NewRequest(http.MethodGet, "/api/desktop/classic-sessions", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestClassicSessionsHandler_ReturnsUserLegacySessions(t *testing.T) {
	t.Parallel()

	now := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)
	list := &stubSessionLister{
		sessions: []store.SessionSummary{{
			ID: "sess-1", Title: "Legacy chat", Type: "chat", Model: "gpt-5.5",
			WorkspacePath: "/ws/a", MessageCount: 3, CreatedAt: now, UpdatedAt: now,
		}},
	}
	handler := classicSessionsHandler(list)

	req := httptest.NewRequest(http.MethodGet, "/api/desktop/classic-sessions", nil)
	user := &auth.UserInfo{ID: "user-octest", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if list.lastUID != "user-octest" {
		t.Fatalf("ListSessions userID = %q, want user-octest", list.lastUID)
	}

	var parsed []map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("len = %d, want 1", len(parsed))
	}
	for _, key := range []string{"id", "title", "type", "model", "workspace_path", "message_count", "created_at", "updated_at"} {
		if _, ok := parsed[0][key]; !ok {
			t.Fatalf("missing field %q in session item: %#v", key, parsed[0])
		}
	}
	if parsed[0]["id"] != "sess-1" {
		t.Fatalf("id = %v", parsed[0]["id"])
	}
}

func TestClassicSessionsHandler_EmptyArrayWhenNoSessions(t *testing.T) {
	t.Parallel()

	list := &stubSessionLister{sessions: nil}
	handler := classicSessionsHandler(list)

	req := httptest.NewRequest(http.MethodGet, "/api/desktop/classic-sessions", nil)
	user := &auth.UserInfo{ID: "fresh-user", Name: "newbie", Email: "new@local.test", Role: "user"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var parsed []interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, rec.Body.String())
	}
	if len(parsed) != 0 {
		t.Fatalf("want empty array, got %v", parsed)
	}
}

func TestClassicSessionsHandler_ScopesListToAuthenticatedUser(t *testing.T) {
	t.Parallel()

	list := &stubSessionLister{
		sessions: []store.SessionSummary{{ID: "only-mine", Title: "t", Type: "chat"}},
	}
	handler := classicSessionsHandler(list)

	req := httptest.NewRequest(http.MethodGet, "/api/desktop/classic-sessions", nil)
	user := &auth.UserInfo{ID: "uid-a", Name: "a", Email: "a@test", Role: "user"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if list.lastUID != "uid-a" {
		t.Fatalf("ListSessions called with userID %q, want uid-a (no cross-user id in request)", list.lastUID)
	}
}
