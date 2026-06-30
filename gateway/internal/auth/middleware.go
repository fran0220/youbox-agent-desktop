package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type contextKey string

const (
	UserContextKey  contextKey = "user"
	TokenContextKey contextKey = "auth_token"
)

var (
	errMissingAuth    = errors.New("missing auth")
	errInvalidSession = errors.New("invalid session")
)

type UserInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type middlewareStore interface {
	ValidateAuthSession(ctx context.Context, token string) (*store.User, error)
	GetUserByContainerToken(ctx context.Context, token string) (*store.User, error)
}

type Middleware struct {
	store      middlewareStore
	adminToken string
}

func NewMiddleware(s *store.Store, adminToken string) *Middleware {
	return NewMiddlewareWithStore(s, adminToken)
}

func NewMiddlewareWithStore(s middlewareStore, adminToken string) *Middleware {
	return &Middleware{
		store:      s,
		adminToken: adminToken,
	}
}

func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, token, err := m.authenticateRequest(r)
		if err != nil {
			if errors.Is(err, errMissingAuth) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing auth"})
				return
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
			return
		}

		next.ServeHTTP(w, r.WithContext(withAuthContext(r.Context(), user, token)))
	})
}

// AuthenticateWithRedirect authenticates like Authenticate, but redirects on failure.
// This is intended for browser page routes such as /chat.
func (m *Middleware) AuthenticateWithRedirect(redirectPath string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, token, err := m.authenticateRequest(r)
		if err != nil {
			http.Redirect(w, r, redirectPath, http.StatusFound)
			return
		}

		next.ServeHTTP(w, r.WithContext(withAuthContext(r.Context(), user, token)))
	})
}

func (m *Middleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUser(r.Context())
		if user == nil || user.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetUser(ctx context.Context) *UserInfo {
	info, _ := ctx.Value(UserContextKey).(*UserInfo)
	return info
}

func GetToken(ctx context.Context) string {
	token, _ := ctx.Value(TokenContextKey).(string)
	return token
}

func withAuthContext(ctx context.Context, user *UserInfo, token string) context.Context {
	ctx = context.WithValue(ctx, UserContextKey, user)
	return context.WithValue(ctx, TokenContextKey, token)
}

func (m *Middleware) authenticateRequest(r *http.Request) (*UserInfo, string, error) {
	token := extractBearerToken(r)
	if token == "" {
		return nil, "", errMissingAuth
	}

	if m.adminToken != "" && token == m.adminToken {
		return &UserInfo{
			ID: "admin", Name: "admin", Email: "admin@jacoworks.local", Role: "admin",
		}, token, nil
	}

	if m.store == nil {
		return nil, "", errInvalidSession
	}

	user, err := m.store.ValidateAuthSession(r.Context(), token)
	if err != nil {
		cUser, cerr := m.store.GetUserByContainerToken(r.Context(), token)
		if cerr != nil {
			log.Debug().Err(err).Msg("session validation failed")
			return nil, "", errInvalidSession
		}
		user = cUser
	}

	return &UserInfo{
		ID:    user.ID,
		Name:  user.Name,
		Email: user.Email,
		Role:  user.Role,
	}, token, nil
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if cookie, err := r.Cookie("auth_token"); err == nil {
		token := strings.TrimSpace(cookie.Value)
		if token != "" {
			return token
		}
	}

	// Fallback: query token only for WebSocket upgrade requests under /ws/*.
	// This avoids leaking auth tokens through URLs on regular HTTP APIs.
	if isWebSocketUpgradeRequest(r) {
		if token := r.URL.Query().Get("token"); token != "" {
			return token
		}
	}
	return ""
}

func isWebSocketUpgradeRequest(r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/ws/") {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return true
	}
	return strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
