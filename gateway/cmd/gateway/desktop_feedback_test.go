package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/github"
)

type stubFeedbackPersistence struct {
	calls []struct {
		name, email, category, message, appVersion string
	}
	err error
}

func (s *stubFeedbackPersistence) InsertFeedback(_ context.Context, name, email, category, message, appVersion string) error {
	s.calls = append(s.calls, struct {
		name, email, category, message, appVersion string
	}{name, email, category, message, appVersion})
	return s.err
}

func TestFeedbackHandler_RequiresAuth(t *testing.T) {
	t.Parallel()

	handler := feedbackHandler(&stubFeedbackPersistence{}, github.NewClient("", ""))
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/feedback", bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestFeedbackHandler_ValidatesRequiredFields(t *testing.T) {
	t.Parallel()

	stub := &stubFeedbackPersistence{}
	handler := feedbackHandler(stub, github.NewClient("", ""))

	body, _ := json.Marshal(map[string]string{
		"category":    "bug",
		"title":       "",
		"description": "something broke",
		"version":     "1.0.0",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/feedback", bytes.NewReader(body))
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if len(stub.calls) != 0 {
		t.Fatalf("expected no DB insert, got %d calls", len(stub.calls))
	}
}

func TestFeedbackHandler_RejectsTooManyImages(t *testing.T) {
	t.Parallel()

	stub := &stubFeedbackPersistence{}
	handler := feedbackHandler(stub, github.NewClient("", ""))

	body, _ := json.Marshal(map[string]interface{}{
		"category":    "bug",
		"title":       "Crash",
		"description": "details",
		"version":     "2.0.0",
		"images":      []string{"a", "b", "c", "d"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/feedback", bytes.NewReader(body))
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if len(stub.calls) != 0 {
		t.Fatalf("expected no DB insert, got %d calls", len(stub.calls))
	}
}

func TestFeedbackHandler_PersistsCategoryAndVersion(t *testing.T) {
	t.Parallel()

	stub := &stubFeedbackPersistence{}
	handler := feedbackHandler(stub, github.NewClient("", ""))

	body, _ := json.Marshal(map[string]string{
		"category":    "bug",
		"title":       "Window freeze",
		"description": "App hangs on launch",
		"version":     "3.4.5",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/desktop/feedback", bytes.NewReader(body))
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(stub.calls) != 1 {
		t.Fatalf("InsertFeedback calls = %d, want 1", len(stub.calls))
	}
	c := stub.calls[0]
	if c.category != "bug" {
		t.Fatalf("category = %q, want bug", c.category)
	}
	if c.appVersion != "3.4.5" {
		t.Fatalf("appVersion = %q, want 3.4.5", c.appVersion)
	}
	if c.message != "Window freeze\n\nApp hangs on launch" {
		t.Fatalf("message = %q", c.message)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp["status"] != "ok" {
		t.Fatalf("status field = %v, want ok", resp["status"])
	}
}
