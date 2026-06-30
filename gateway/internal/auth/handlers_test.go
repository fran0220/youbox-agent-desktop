package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type authStoreMock struct {
	getUserByEmailFn         func(ctx context.Context, email string) (*store.User, error)
	getUserByNameFn          func(ctx context.Context, name string) (*store.User, error)
	createAuthSessionFn      func(ctx context.Context, token, userID string, ttl time.Duration, ip, userAgent string) error
	validateInviteCodeFn     func(ctx context.Context, code string) (*store.InviteCode, error)
	createUserFn             func(ctx context.Context, name, email, passwordHash, role string) (*store.User, error)
	useInviteCodeFn          func(ctx context.Context, code, userID string) error
	deleteAuthSessionFn      func(ctx context.Context, token string) error
	findOrCreateFeishuUserFn func(ctx context.Context, feishuOpenID, name, email string) (*store.User, error)

	getByEmailCalls     int
	getByNameCalls      int
	createSessionCalls  int
	validateInviteCalls int
	createUserCalls     int
	useInviteCalls      int
	deleteSessionCalls  int
	findFeishuCalls     int
}

func (m *authStoreMock) GetUserByEmail(ctx context.Context, email string) (*store.User, error) {
	m.getByEmailCalls++
	if m.getUserByEmailFn == nil {
		return nil, errors.New("GetUserByEmail not mocked")
	}
	return m.getUserByEmailFn(ctx, email)
}

func (m *authStoreMock) GetUserByName(ctx context.Context, name string) (*store.User, error) {
	m.getByNameCalls++
	if m.getUserByNameFn == nil {
		return nil, errors.New("GetUserByName not mocked")
	}
	return m.getUserByNameFn(ctx, name)
}

func (m *authStoreMock) CreateAuthSession(ctx context.Context, token, userID string, ttl time.Duration, ip, userAgent string) error {
	m.createSessionCalls++
	if m.createAuthSessionFn == nil {
		return errors.New("CreateAuthSession not mocked")
	}
	return m.createAuthSessionFn(ctx, token, userID, ttl, ip, userAgent)
}

func (m *authStoreMock) ValidateInviteCode(ctx context.Context, code string) (*store.InviteCode, error) {
	m.validateInviteCalls++
	if m.validateInviteCodeFn == nil {
		return nil, errors.New("ValidateInviteCode not mocked")
	}
	return m.validateInviteCodeFn(ctx, code)
}

func (m *authStoreMock) CreateUser(ctx context.Context, name, email, passwordHash, role string) (*store.User, error) {
	m.createUserCalls++
	if m.createUserFn == nil {
		return nil, errors.New("CreateUser not mocked")
	}
	return m.createUserFn(ctx, name, email, passwordHash, role)
}

func (m *authStoreMock) UseInviteCode(ctx context.Context, code, userID string) error {
	m.useInviteCalls++
	if m.useInviteCodeFn == nil {
		return errors.New("UseInviteCode not mocked")
	}
	return m.useInviteCodeFn(ctx, code, userID)
}

func (m *authStoreMock) DeleteAuthSession(ctx context.Context, token string) error {
	m.deleteSessionCalls++
	if m.deleteAuthSessionFn == nil {
		return nil
	}
	return m.deleteAuthSessionFn(ctx, token)
}

func (m *authStoreMock) FindOrCreateFeishuUser(ctx context.Context, feishuOpenID, name, email string) (*store.User, error) {
	m.findFeishuCalls++
	if m.findOrCreateFeishuUserFn == nil {
		return nil, errors.New("FindOrCreateFeishuUser not mocked")
	}
	return m.findOrCreateFeishuUserFn(ctx, feishuOpenID, name, email)
}

func TestLoginValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		body      string
		wantCode  int
		wantError string
	}{
		{name: "invalid json", body: "{", wantCode: http.StatusBadRequest, wantError: "invalid request"},
		{name: "empty payload", body: `{}`, wantCode: http.StatusBadRequest, wantError: "username and password required"},
		{name: "missing username", body: `{"password":"secret"}`, wantCode: http.StatusBadRequest, wantError: "username and password required"},
		{name: "missing password", body: `{"username":"alice"}`, wantCode: http.StatusBadRequest, wantError: "username and password required"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mock := &authStoreMock{}
			h := NewHandlersWithStore(mock, 24)

			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(tt.body))
			rr := httptest.NewRecorder()

			h.Login(rr, req)

			if rr.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d", rr.Code, tt.wantCode)
			}

			var body map[string]string
			if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body["error"] != tt.wantError {
				t.Fatalf("error = %q, want %q", body["error"], tt.wantError)
			}

			if mock.getByEmailCalls != 0 || mock.getByNameCalls != 0 || mock.createSessionCalls != 0 {
				t.Fatalf("store should not be called for validation errors")
			}
		})
	}
}

func TestActivateValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		body      string
		wantCode  int
		wantError string
	}{
		{name: "invalid json", body: "{", wantCode: http.StatusBadRequest, wantError: "invalid request"},
		{name: "missing code", body: `{"username":"alice","password":"secret"}`, wantCode: http.StatusBadRequest, wantError: "code, username, password required"},
		{name: "missing username", body: `{"code":"JACO-TEST-2026","password":"secret"}`, wantCode: http.StatusBadRequest, wantError: "code, username, password required"},
		{name: "missing password", body: `{"code":"JACO-TEST-2026","username":"alice"}`, wantCode: http.StatusBadRequest, wantError: "code, username, password required"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mock := &authStoreMock{}
			h := NewHandlersWithStore(mock, 24)

			req := httptest.NewRequest(http.MethodPost, "/api/auth/activate", strings.NewReader(tt.body))
			rr := httptest.NewRecorder()

			h.Activate(rr, req)

			if rr.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d", rr.Code, tt.wantCode)
			}

			var body map[string]string
			if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body["error"] != tt.wantError {
				t.Fatalf("error = %q, want %q", body["error"], tt.wantError)
			}

			if mock.validateInviteCalls != 0 || mock.createUserCalls != 0 || mock.createSessionCalls != 0 {
				t.Fatalf("store should not be called for validation errors")
			}
		})
	}
}

func TestLogout(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                string
		authorization       string
		url                 string
		wantDeleteCallCount int
	}{
		{name: "without token", authorization: "", url: "/api/auth/logout", wantDeleteCallCount: 0},
		{name: "with bearer token", authorization: "Bearer session-token", url: "/api/auth/logout", wantDeleteCallCount: 1},
		{name: "query token is ignored on HTTP API", authorization: "", url: "/api/auth/logout?token=from-query", wantDeleteCallCount: 0},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mock := &authStoreMock{}
			h := NewHandlersWithStore(mock, 24)

			req := httptest.NewRequest(http.MethodPost, tt.url, nil)
			if tt.authorization != "" {
				req.Header.Set("Authorization", tt.authorization)
			}

			rr := httptest.NewRecorder()
			h.Logout(rr, req)

			if rr.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
			}
			if mock.deleteSessionCalls != tt.wantDeleteCallCount {
				t.Fatalf("delete calls = %d, want %d", mock.deleteSessionCalls, tt.wantDeleteCallCount)
			}
		})
	}
}

func TestNewHandlers_DefaultSessionTTL(t *testing.T) {
	t.Parallel()

	h := NewHandlersWithStore(&authStoreMock{}, 0)
	if h.sessionTTL != 168*time.Hour {
		t.Fatalf("session TTL = %v, want %v", h.sessionTTL, 168*time.Hour)
	}
}

func TestResolveFeishuRedirect(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		raw       string
		wantErr   bool
		wantQuery bool
	}{
		{name: "default redirect", raw: "", wantErr: false, wantQuery: false},
		{name: "desktop localhost", raw: "http://localhost:1420/callback", wantErr: false, wantQuery: false},
		{name: "tauri localhost", raw: "https://tauri.localhost", wantErr: false, wantQuery: false},
		{name: "tauri scheme", raw: "tauri://localhost", wantErr: false, wantQuery: false},
		{name: "admin callback uses query", raw: "https://jaco.jingao.club/admin/feishu/callback", wantErr: false, wantQuery: true},
		{name: "reject javascript scheme", raw: "javascript:alert(1)", wantErr: true},
		{name: "reject unknown host", raw: "https://evil.example.com/cb", wantErr: true},
		{name: "reject relative url", raw: "/admin/feishu/callback", wantErr: true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			redirect, useQuery, err := resolveFeishuRedirect(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got redirect=%q", redirect)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if useQuery != tt.wantQuery {
				t.Fatalf("useQuery = %v, want %v", useQuery, tt.wantQuery)
			}
			parsed, parseErr := url.Parse(redirect)
			if parseErr != nil {
				t.Fatalf("redirect parse failed: %v", parseErr)
			}
			if parsed.Fragment != "" {
				t.Fatalf("redirect fragment should be empty, got %q", parsed.Fragment)
			}
			if strings.Contains(parsed.RawQuery, "token=") || strings.Contains(parsed.RawQuery, "error=") {
				t.Fatalf("redirect query should not carry auth params, got %q", parsed.RawQuery)
			}
		})
	}
}

func TestAppendAuthResult(t *testing.T) {
	t.Parallel()

	queryURL := appendAuthResult("https://jaco.jingao.club/admin/feishu/callback?foo=1", true, "token", "abc")
	if !strings.Contains(queryURL, "token=abc") || strings.Contains(queryURL, "#") {
		t.Fatalf("query mode redirect malformed: %q", queryURL)
	}

	hashURL := appendAuthResult("http://localhost:1420", false, "token", "abc")
	if !strings.Contains(hashURL, "#token=abc") || strings.Contains(hashURL, "?token=") {
		t.Fatalf("fragment mode redirect malformed: %q", hashURL)
	}
}
