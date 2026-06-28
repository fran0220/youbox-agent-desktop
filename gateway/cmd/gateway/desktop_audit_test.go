package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestDesktopAuditHandler_RedactsSecretsInResourceID(t *testing.T) {
	t.Parallel()
	stub := &stubAuditRecorder{}
	body, _ := json.Marshal(desktopAuditRequest{
		Action:       "tool_bash",
		ResourceType: "bash",
		ResourceID:   "export API_KEY=sk-leakme1234567890",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body))
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "a@b.c", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	desktopAuditHandler(stub).ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	if len(stub.calls) != 1 {
		t.Fatalf("calls: %+v", stub.calls)
	}
	rid := stub.calls[0].resourceID
	if strings.Contains(rid, "sk-leak") {
		t.Fatalf("secret leaked in resource_id: %q", rid)
	}
}

func TestDesktopAuditHandler_CapturesCommandAndPath(t *testing.T) {
	t.Parallel()
	stub := &stubAuditRecorder{}
	path := "/tmp/ocn-audit-probe-test.txt"
	cmd := "echo OCN_AUDIT_MARKER_test"
	for _, tc := range []struct {
		action, rtype, rid string
	}{
		{"tool_write", "file", path},
		{"tool_bash", "bash", cmd},
	} {
		body, _ := json.Marshal(desktopAuditRequest{Action: tc.action, ResourceType: tc.rtype, ResourceID: tc.rid})
		req := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body))
		user := &auth.UserInfo{ID: "uid-1", Name: "octest", Email: "a@b.c", Role: "admin"}
		ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()
		desktopAuditHandler(stub).ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("%s: status %d", tc.action, rec.Code)
		}
	}
	last := stub.calls[len(stub.calls)-1]
	if last.resourceID != cmd {
		t.Fatalf("bash resource_id = %q", last.resourceID)
	}
	prev := stub.calls[len(stub.calls)-2]
	if prev.resourceID != path {
		t.Fatalf("write resource_id = %q", prev.resourceID)
	}
}
