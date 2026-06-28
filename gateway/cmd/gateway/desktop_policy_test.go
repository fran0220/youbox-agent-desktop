package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
)

func TestBuildDesktopPolicyResponse_AdminAllowsAll(t *testing.T) {
	t.Parallel()
	body := buildDesktopPolicyResponse("admin")
	flags, ok := body["flags"].(map[string]bool)
	if !ok {
		t.Fatalf("flags type: %T", body["flags"])
	}
	for _, key := range []string{"allow_bash", "allow_file_write", "allow_mcp", "allow_api_mutations"} {
		if !flags[key] {
			t.Fatalf("admin should allow %s", key)
		}
	}
	if body["require_high_risk_confirmation"] != true {
		t.Fatal("expected high-risk confirmation required")
	}
}

func TestBuildDesktopPolicyResponse_ViewerRestricts(t *testing.T) {
	t.Parallel()
	body := buildDesktopPolicyResponse("viewer")
	flags := body["flags"].(map[string]bool)
	if flags["allow_bash"] || flags["allow_file_write"] {
		t.Fatal("viewer role should deny bash and file writes")
	}
}

func TestDesktopPolicyHandler_ReturnsRole(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/api/desktop/policy", nil)
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "a@b.c", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	desktopPolicyHandler()(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["role"] != "admin" {
		t.Fatalf("role %v", parsed["role"])
	}
}
