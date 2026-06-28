package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
)

type stubAuditRecorder struct {
	calls []struct {
		userID, action, resourceType, resourceID, ip string
	}
}

func (s *stubAuditRecorder) Log(userID, action, resourceType, resourceID, ip string) {
	s.calls = append(s.calls, struct {
		userID, action, resourceType, resourceID, ip string
	}{userID, action, resourceType, resourceID, ip})
}

func TestDesktopAuditHandler_Unauthorized(t *testing.T) {
	t.Parallel()
	al := audit.NewLogger(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()
	desktopAuditHandler(al).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestDesktopAuditHandler_MissingAction(t *testing.T) {
	t.Parallel()
	al := audit.NewLogger(nil)
	body, _ := json.Marshal(desktopAuditRequest{ResourceType: "tool", ResourceID: "x"})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body))
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "a@b.c", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	desktopAuditHandler(al).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestDesktopAuditHandler_Success(t *testing.T) {
	t.Parallel()
	stub := &stubAuditRecorder{}
	body, _ := json.Marshal(desktopAuditRequest{
		Action:       "tool_bash",
		ResourceType: "bash",
		ResourceID:   "echo hello",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body))
	user := &auth.UserInfo{ID: "octest-id", Name: "octest", Email: "a@b.c", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	desktopAuditHandler(stub).ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(stub.calls) != 1 || stub.calls[0].action != "tool_bash" || stub.calls[0].userID != "octest-id" {
		t.Fatalf("unexpected stub calls: %+v", stub.calls)
	}
}
