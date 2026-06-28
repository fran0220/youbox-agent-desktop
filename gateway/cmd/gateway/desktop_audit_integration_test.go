package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	if u := os.Getenv("GATEWAY_DATABASE_URL"); u != "" {
		return u
	}
	return "postgresql://jaco:jaco@localhost:5433/jacoworks"
}

func TestDesktopAuditHandler_PersistsToAuditLogs(t *testing.T) {
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	s, err := store.New(ctx, dbURL)
	if err != nil {
		t.Skipf("local postgres not available: %v", err)
	}
	defer s.Close()

	al := audit.NewLogger(s.Pool())
	octestID := "1b26f2ae-3f03-482b-96ea-034cdb8c4cb8"
	marker := "OCN_ITEST_" + time.Now().Format("150405")
	pathProbe := "/tmp/ocn-audit-itest-" + marker + ".txt"

	body1, _ := json.Marshal(desktopAuditRequest{
		Action: "tool_write", ResourceType: "file", ResourceID: pathProbe,
	})
	req1 := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body1))
	user := &auth.UserInfo{ID: octestID, Name: "octest", Email: "octest@local.test", Role: "admin"}
	req1 = req1.WithContext(context.WithValue(req1.Context(), auth.UserContextKey, user))
	rec1 := httptest.NewRecorder()
	desktopAuditHandler(al).ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusNoContent {
		t.Fatalf("first post: %d %s", rec1.Code, rec1.Body.String())
	}

	time.Sleep(20 * time.Millisecond)

	body2, _ := json.Marshal(desktopAuditRequest{
		Action: "tool_bash", ResourceType: "bash", ResourceID: "echo " + marker,
	})
	req2 := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body2))
	req2 = req2.WithContext(context.WithValue(req2.Context(), auth.UserContextKey, user))
	rec2 := httptest.NewRecorder()
	desktopAuditHandler(al).ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusNoContent {
		t.Fatalf("second post: %d", rec2.Code)
	}

	pool := s.Pool()
	var userID, action, resourceID string
	var t1, t2 time.Time
	err = pool.QueryRow(ctx, `
		SELECT user_id, action, resource_id, created_at FROM audit_logs
		WHERE resource_id = $1 ORDER BY created_at DESC LIMIT 1`, pathProbe).
		Scan(&userID, &action, &resourceID, &t1)
	if err != nil {
		t.Fatalf("query write row: %v", err)
	}
	if userID != octestID {
		t.Fatalf("user_id %q want octest id", userID)
	}
	if resourceID != pathProbe {
		t.Fatalf("path resource_id %q", resourceID)
	}

	err = pool.QueryRow(ctx, `
		SELECT created_at FROM audit_logs WHERE resource_id = $1 ORDER BY created_at DESC LIMIT 1`,
		"echo "+marker).Scan(&t2)
	if err != nil {
		t.Fatalf("query bash row: %v", err)
	}
	if t2.Before(t1) {
		t.Fatalf("timestamps not monotonic: t1=%v t2=%v", t1, t2)
	}
	if time.Since(t2) > 2*time.Minute {
		t.Fatalf("timestamp stale: %v", t2)
	}

	secretBody, _ := json.Marshal(desktopAuditRequest{
		Action: "tool_bash", ResourceType: "bash",
		ResourceID: "export API_KEY=sk-integrationtestkey999",
	})
	req3 := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(secretBody))
	req3 = req3.WithContext(context.WithValue(req3.Context(), auth.UserContextKey, user))
	rec3 := httptest.NewRecorder()
	desktopAuditHandler(al).ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusNoContent {
		t.Fatalf("secret post: %d", rec3.Code)
	}

	var stored string
	_ = pool.QueryRow(ctx, `
		SELECT resource_id FROM audit_logs
		WHERE action = 'tool_bash' AND resource_id LIKE '%integrationtest%'
		ORDER BY created_at DESC LIMIT 1`).Scan(&stored)
	if stored != "" && strings.Contains(stored, "sk-integration") {
		t.Fatalf("secret in DB: %q", stored)
	}
}

func TestDesktopAuditHandler_UnauthenticatedDoesNotInsert(t *testing.T) {
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Skipf("postgres: %v", err)
	}
	defer pool.Close()

	var before int64
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&before)

	body, _ := json.Marshal(desktopAuditRequest{Action: "tool_x", ResourceType: "tool", ResourceID: "noop"})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/audit", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	desktopAuditHandler(audit.NewLogger(pool)).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}

	var after int64
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&after)
	if after != before {
		t.Fatalf("row count changed %d -> %d on 401", before, after)
	}
}
