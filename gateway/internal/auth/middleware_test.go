package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type middlewareStoreMock struct {
	validateAuthSessionFn     func(ctx context.Context, token string) (*store.User, error)
	getUserByContainerTokenFn func(ctx context.Context, token string) (*store.User, error)

	validateCalls  int
	containerCalls int
}

func (m *middlewareStoreMock) ValidateAuthSession(ctx context.Context, token string) (*store.User, error) {
	m.validateCalls++
	if m.validateAuthSessionFn == nil {
		return nil, errors.New("validate session not mocked")
	}
	return m.validateAuthSessionFn(ctx, token)
}

func (m *middlewareStoreMock) GetUserByContainerToken(ctx context.Context, token string) (*store.User, error) {
	m.containerCalls++
	if m.getUserByContainerTokenFn == nil {
		return nil, errors.New("container token lookup not mocked")
	}
	return m.getUserByContainerTokenFn(ctx, token)
}

func TestAuthenticate_UnauthorizedCases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		authorization string
		url           string
		wantError     string
		store         middlewareStore
	}{
		{
			name:      "missing authorization header",
			url:       "http://example.com/api",
			wantError: "missing auth",
		},
		{
			name:          "malformed authorization header",
			authorization: "Token abc",
			url:           "http://example.com/api",
			wantError:     "missing auth",
		},
		{
			name:          "invalid bearer token",
			authorization: "Bearer invalid-token",
			url:           "http://example.com/api",
			wantError:     "invalid session",
			store: &middlewareStoreMock{
				validateAuthSessionFn: func(ctx context.Context, token string) (*store.User, error) {
					return nil, errors.New("not found")
				},
				getUserByContainerTokenFn: func(ctx context.Context, token string) (*store.User, error) {
					return nil, errors.New("container token not found")
				},
			},
		},
		{
			name:          "store missing with bearer token",
			authorization: "Bearer any-token",
			url:           "http://example.com/api",
			wantError:     "invalid session",
			store:         nil,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mw := NewMiddlewareWithStore(tt.store, "admin-secret")
			nextCalled := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			if tt.authorization != "" {
				req.Header.Set("Authorization", tt.authorization)
			}
			rr := httptest.NewRecorder()

			mw.Authenticate(next).ServeHTTP(rr, req)

			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
			}
			if nextCalled {
				t.Fatalf("next handler should not be called")
			}

			var body map[string]string
			if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body["error"] != tt.wantError {
				t.Fatalf("error = %q, want %q", body["error"], tt.wantError)
			}
		})
	}
}

func TestAuthenticate_AdminTokenPassthrough(t *testing.T) {
	t.Parallel()

	mw := NewMiddlewareWithStore(&middlewareStoreMock{}, "admin-secret")
	var gotUser *UserInfo

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser = GetUser(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "http://example.com/api", nil)
	req.Header.Set("Authorization", "Bearer admin-secret")
	rr := httptest.NewRecorder()

	mw.Authenticate(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if gotUser == nil {
		t.Fatalf("expected user in context")
	}
	if gotUser.Role != "admin" {
		t.Fatalf("role = %q, want %q", gotUser.Role, "admin")
	}
}

func TestAuthenticate_ValidSessionAndContainerFallback(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name              string
		authorization     string
		cookieToken       string
		store             *middlewareStoreMock
		wantID            string
		wantToken         string
		wantValidateCall  int
		wantContainerCall int
	}{
		{
			name:          "valid session token",
			authorization: "Bearer runtime-token",
			store: &middlewareStoreMock{
				validateAuthSessionFn: func(ctx context.Context, token string) (*store.User, error) {
					return &store.User{ID: "u-1", Name: "alice", Email: "alice@example.com", Role: "user"}, nil
				},
				getUserByContainerTokenFn: func(ctx context.Context, token string) (*store.User, error) {
					return nil, errors.New("should not be called")
				},
			},
			wantID:            "u-1",
			wantToken:         "runtime-token",
			wantValidateCall:  1,
			wantContainerCall: 0,
		},
		{
			name:        "container token fallback from cookie",
			cookieToken: "cookie-container-token",
			store: &middlewareStoreMock{
				validateAuthSessionFn: func(ctx context.Context, token string) (*store.User, error) {
					return nil, errors.New("session not found")
				},
				getUserByContainerTokenFn: func(ctx context.Context, token string) (*store.User, error) {
					return &store.User{ID: "u-2", Name: "bot", Email: "bot@local", Role: "user"}, nil
				},
			},
			wantID:            "u-2",
			wantToken:         "cookie-container-token",
			wantValidateCall:  1,
			wantContainerCall: 1,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mw := NewMiddlewareWithStore(tt.store, "")
			var gotUser *UserInfo
			var gotToken string
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotUser = GetUser(r.Context())
				gotToken = GetToken(r.Context())
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "http://example.com/api", nil)
			if tt.authorization != "" {
				req.Header.Set("Authorization", tt.authorization)
			}
			if tt.cookieToken != "" {
				req.AddCookie(&http.Cookie{Name: "auth_token", Value: tt.cookieToken})
			}
			rr := httptest.NewRecorder()

			mw.Authenticate(next).ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
			}
			if gotUser == nil {
				t.Fatalf("expected user in context")
			}
			if gotUser.ID != tt.wantID {
				t.Fatalf("user id = %q, want %q", gotUser.ID, tt.wantID)
			}
			if gotToken != tt.wantToken {
				t.Fatalf("token = %q, want %q", gotToken, tt.wantToken)
			}
			if tt.store.validateCalls != tt.wantValidateCall {
				t.Fatalf("validate calls = %d, want %d", tt.store.validateCalls, tt.wantValidateCall)
			}
			if tt.store.containerCalls != tt.wantContainerCall {
				t.Fatalf("container calls = %d, want %d", tt.store.containerCalls, tt.wantContainerCall)
			}
		})
	}
}

func TestAuthenticateWithRedirect(t *testing.T) {
	t.Parallel()

	store := &middlewareStoreMock{
		validateAuthSessionFn: func(ctx context.Context, token string) (*store.User, error) {
			if token != "cookie-token" {
				return nil, errors.New("bad token")
			}
			return &store.User{ID: "u-3", Name: "carol", Email: "carol@example.com", Role: "user"}, nil
		},
		getUserByContainerTokenFn: func(ctx context.Context, token string) (*store.User, error) {
			return nil, errors.New("not container token")
		},
	}

	mw := NewMiddlewareWithStore(store, "")
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("redirects when missing auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://example.com/chat", nil)
		rr := httptest.NewRecorder()

		mw.AuthenticateWithRedirect("/login", next).ServeHTTP(rr, req)

		if rr.Code != http.StatusFound {
			t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
		}
		if location := rr.Header().Get("Location"); location != "/login" {
			t.Fatalf("location = %q, want %q", location, "/login")
		}
	})

	t.Run("passes through when cookie auth is valid", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://example.com/chat", nil)
		req.AddCookie(&http.Cookie{Name: "auth_token", Value: "cookie-token"})
		rr := httptest.NewRecorder()

		mw.AuthenticateWithRedirect("/login", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user := GetUser(r.Context()); user == nil || user.ID != "u-3" {
				t.Fatalf("unexpected user context: %#v", user)
			}
			if token := GetToken(r.Context()); token != "cookie-token" {
				t.Fatalf("token = %q, want %q", token, "cookie-token")
			}
			w.WriteHeader(http.StatusOK)
		})).ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
		}
	})
}

func TestRequireAdmin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		user       *UserInfo
		wantStatus int
	}{
		{name: "missing user", user: nil, wantStatus: http.StatusForbidden},
		{name: "non-admin user", user: &UserInfo{ID: "u1", Role: "user"}, wantStatus: http.StatusForbidden},
		{name: "admin user", user: &UserInfo{ID: "admin", Role: "admin"}, wantStatus: http.StatusOK},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mw := &Middleware{}
			nextCalled := false
			h := mw.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodGet, "http://example.com/api", nil)
			if tt.user != nil {
				req = req.WithContext(context.WithValue(req.Context(), UserContextKey, tt.user))
			}
			rr := httptest.NewRecorder()

			h.ServeHTTP(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tt.wantStatus)
			}
			if nextCalled != (tt.wantStatus == http.StatusOK) {
				t.Fatalf("next called = %v, want %v", nextCalled, tt.wantStatus == http.StatusOK)
			}
		})
	}
}

func TestExtractBearerToken(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		authorization string
		cookieToken   string
		headers       map[string]string
		url           string
		want          string
	}{
		{name: "bearer header", authorization: "Bearer abc", url: "http://example.com/ws/agent", want: "abc"},
		{name: "cookie fallback", cookieToken: "cookie-token", url: "http://example.com/api/users/me", want: "cookie-token"},
		{
			name: "query fallback for websocket upgrade",
			url:  "http://example.com/ws/agent?token=q123",
			headers: map[string]string{
				"Upgrade":    "websocket",
				"Connection": "Upgrade",
			},
			want: "q123",
		},
		{name: "query token ignored for non websocket path", url: "http://example.com/api/users/me?token=q123", want: ""},
		{name: "header has priority", authorization: "Bearer header-token", cookieToken: "cookie-token", url: "http://example.com/ws/agent?token=query-token", want: "header-token"},
		{name: "missing token", url: "http://example.com/ws/agent", want: ""},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			if tt.authorization != "" {
				req.Header.Set("Authorization", tt.authorization)
			}
			if tt.cookieToken != "" {
				req.AddCookie(&http.Cookie{Name: "auth_token", Value: tt.cookieToken})
			}
			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}

			if got := extractBearerToken(req); got != tt.want {
				t.Fatalf("token = %q, want %q", got, tt.want)
			}
		})
	}
}
