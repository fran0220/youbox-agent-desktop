package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/markbates/goth"
	posthog "github.com/posthog/posthog-go"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/agent"
	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/auth/feishu"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/feishubot"
	"github.com/fran0220/jacoworks/gateway/internal/games"
	"github.com/fran0220/jacoworks/gateway/internal/github"
	"github.com/fran0220/jacoworks/gateway/internal/middleware"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

func main() {
	configPath := "gateway.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	var logWriter zerolog.LevelWriter
	if isTerminal() {
		logWriter = zerolog.MultiLevelWriter(
			zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339},
		)
	} else {
		logWriter = zerolog.MultiLevelWriter(os.Stderr)
	}
	log.Logger = zerolog.New(logWriter).With().Timestamp().Caller().Logger()

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatal().Err(err).Msg("load config")
	}
	log.Info().Str("addr", cfg.Addr()).Msg("config loaded")

	// Initialize PostgreSQL
	ctx := context.Background()
	s, err := store.New(ctx, cfg.Database.URL)
	if err != nil {
		log.Fatal().Err(err).Msg("init database")
	}
	defer s.Close()

	// Load settings from DB (overrides YAML values)
	if dbSettings, err := s.GetAllSettings(ctx); err == nil {
		llm := cfg.GetLLM()
		for _, setting := range dbSettings {
			if setting.Value == "" {
				continue
			}
			switch setting.Key {
			case "llm_proxy_url":
				llm.ProxyURL = setting.Value
			case "llm_proxy_key":
				llm.ProxyKey = setting.Value
			case "openai_api_key":
				llm.OpenAIAPIKey = setting.Value
			case "exa_api_key":
				llm.ExaAPIKey = setting.Value
			case "tavily_api_key":
				llm.TavilyKey = setting.Value
			case "embedding_base_url":
				llm.EmbeddingBaseURL = setting.Value
			case "embedding_api_key":
				llm.EmbeddingAPIKey = setting.Value
			case "fal_api_key":
				llm.FalAPIKey = setting.Value
			case "mineru_token":
				llm.MineruToken = setting.Value
			case "jimeng_api_url":
				llm.JimengAPIURL = setting.Value
			case "jimeng_api_key":
				llm.JimengAPIKey = setting.Value
			case "asset_gateway_token":
				llm.AssetGatewayToken = setting.Value
			case "asset_gateway_url":
				llm.AssetGatewayURL = setting.Value
			case "ai_search_gateway_url":
				llm.AISearchGatewayURL = setting.Value
			case "ai_search_token":
				llm.AISearchToken = setting.Value
			case "primary_model":
				llm.PrimaryModel = setting.Value
			case "primary_provider":
				llm.PrimaryProvider = setting.Value
			case "feishu_client_id":
				cfg.Auth.FeishuClientID = setting.Value
			case "feishu_client_secret":
				cfg.Auth.FeishuClientSecret = setting.Value
			case "admin_token":
				cfg.Auth.AdminToken = setting.Value
			case "github_token":
				cfg.GitHub.Token = setting.Value
			case "github_repo":
				cfg.GitHub.Repo = setting.Value
			case "posthog_api_key":
				cfg.PostHog.APIKey = setting.Value
			case "posthog_endpoint":
				cfg.PostHog.Endpoint = setting.Value
			case "oc_gateway_url":
				cfg.OcGatewayURL = setting.Value
			case "cli_tools_manifest":
				cfg.SetCliToolsManifest(setting.Value)
			}
		}
		cfg.UpdateLLM(llm)
		log.Info().Msg("loaded settings from database")
	}

	auditLogger := audit.NewLogger(s.Pool())

	// Initialize PostHog client (error tracking + analytics, hot-reloadable via admin settings)
	ph := &postHogHolder{}
	ph.Reload(cfg.PostHog.APIKey, cfg.PostHog.Endpoint)
	ph.CaptureEvent("gateway-server", "gateway_started", map[string]interface{}{
		"addr": cfg.Addr(),
	})

	// Initialize Goth providers
	if cfg.Auth.FeishuClientID != "" {
		baseURL := cfg.Server.PublicURL
		if baseURL == "" {
			baseURL = fmt.Sprintf("http://%s", cfg.Addr())
		}
		callbackURL := baseURL + "/api/auth/feishu/callback"
		goth.UseProviders(feishu.New(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret, callbackURL))
		log.Info().Str("callback", callbackURL).Msg("feishu SSO provider registered")
	}

	// Initialize handlers
	authMiddleware := auth.NewMiddleware(s, cfg.Auth.AdminToken)
	authHandlers := auth.NewHandlers(s, cfg.Auth.SessionTTLHours)

	wsTicketStore := agent.NewTicketStore(30 * time.Second)
	defer wsTicketStore.Close()

	// Initialize Feishu Bot handler (proxies to oc-gateway for Pi routing)
	feishuBotClient := feishubot.NewClient(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret)
	feishuBotHandler := feishubot.NewHandler(feishuBotClient, s)
	if cfg.OcGatewayURL != "" {
		feishuBotHandler.SetOcGatewayURL(cfg.OcGatewayURL)
		log.Info().Str("url", cfg.OcGatewayURL).Msg("feishu bot: proxying to oc-gateway")
	}
	gamesHandler := games.NewHandler(s)
	ghClient := github.NewClient(cfg.GitHub.Token, cfg.GitHub.Repo)

	mux := http.NewServeMux()

	// Feishu webhook (no auth — Feishu platform calls this)
	mux.HandleFunc("POST /api/feishu/webhook", feishuBotHandler.HandleWebhook)

	// Auth endpoints (no auth required)
	mux.HandleFunc("POST /api/auth/login", authHandlers.Login)
	mux.HandleFunc("POST /api/auth/activate", authHandlers.Activate)
	mux.HandleFunc("GET /api/auth/feishu", authHandlers.FeishuBegin)
	mux.HandleFunc("GET /api/auth/feishu/callback", authHandlers.FeishuCallback)

	// Auth endpoints (auth required)
	mux.Handle("POST /api/auth/logout", authMiddleware.Authenticate(http.HandlerFunc(authHandlers.Logout)))

	// Authenticated: user info
	mux.Handle("GET /api/users/me", authMiddleware.Authenticate(http.HandlerFunc(meHandler)))

	// Authenticated: sessions
	mux.Handle("GET /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(listSessionsHandler(s))))
	mux.Handle("POST /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(createSessionHandler(s))))
	mux.Handle("GET /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(getSessionHandler(s))))
	mux.Handle("PUT /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(updateSessionHandler(s))))
	mux.Handle("DELETE /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteSessionHandler(s))))

	// Authenticated: agent config
	mux.Handle("GET /api/agent/config", authMiddleware.Authenticate(http.HandlerFunc(agentConfigHandler(cfg, s))))

	// Authenticated: desktop LLM config (non-LLM secrets redacted)
	mux.Handle("GET /api/desktop/config", authMiddleware.Authenticate(http.HandlerFunc(desktopConfigHandler(cfg, s))))
	mux.Handle("GET /api/desktop/classic-sessions", authMiddleware.Authenticate(http.HandlerFunc(classicSessionsHandler(s))))
	mux.Handle("POST /api/desktop/session-metadata", authMiddleware.Authenticate(http.HandlerFunc(desktopSessionMetadataHandler(s))))
	desktopTrustCfg := loadDesktopWorkspaceTrustConfig()
	mux.Handle("GET /api/desktop/policy", authMiddleware.Authenticate(desktopPolicyHandler(desktopTrustCfg)))
	mux.Handle("POST /api/desktop/audit", authMiddleware.Authenticate(http.HandlerFunc(desktopAuditHandler(auditLogger))))
	mux.Handle("GET /api/desktop/release/latest", authMiddleware.Authenticate(http.HandlerFunc(desktopReleaseLatestHandler(s))))
	mux.Handle("GET /api/desktop/release/latest.yml", authMiddleware.Authenticate(http.HandlerFunc(desktopReleaseFeedHandler(s))))
	mux.Handle("GET /api/desktop/release/latest-mac.yml", authMiddleware.Authenticate(http.HandlerFunc(desktopReleaseFeedHandler(s))))
	mux.Handle("GET /api/desktop/release/latest-linux.yml", authMiddleware.Authenticate(http.HandlerFunc(desktopReleaseFeedHandler(s))))
	mux.Handle("GET /api/desktop/release/latest-linux-arm64.yml", authMiddleware.Authenticate(http.HandlerFunc(desktopReleaseFeedHandler(s))))

	// Authenticated: memory sync & management
	mux.Handle("POST /api/memory/sync", authMiddleware.Authenticate(http.HandlerFunc(memorySyncHandler(s))))
	mux.Handle("GET /api/memory/search", authMiddleware.Authenticate(http.HandlerFunc(memorySearchHandler(s))))
	mux.Handle("GET /api/memory/stats", authMiddleware.Authenticate(http.HandlerFunc(memoryStatsHandler(s))))
	mux.Handle("DELETE /api/memory/file", authMiddleware.Authenticate(http.HandlerFunc(memoryDeleteFileHandler(s))))
	mux.Handle("DELETE /api/memory", authMiddleware.Authenticate(http.HandlerFunc(memoryClearHandler(s))))

	// Authenticated: skills sync (legacy — retained for push-skills.sh)
	mux.Handle("POST /api/skills/upload", authMiddleware.Authenticate(http.HandlerFunc(skillsUploadHandler(s))))
	mux.Handle("GET /api/skills/checksum", authMiddleware.Authenticate(http.HandlerFunc(skillsChecksumHandler(s))))
	mux.Handle("GET /api/skills/pull", authMiddleware.Authenticate(http.HandlerFunc(skillsPullHandler(s))))

	// Authenticated: skills CRUD (desktop → gateway DB)
	mux.Handle("GET /api/skills", authMiddleware.Authenticate(http.HandlerFunc(skillsListHandler(s))))
	mux.Handle("PUT /api/skills/{skillId}", authMiddleware.Authenticate(http.HandlerFunc(skillsUpsertHandler(s))))
	mux.Handle("DELETE /api/skills/{skillId}", authMiddleware.Authenticate(http.HandlerFunc(skillsDeleteHandler(s))))

	// Pi VM routes — migrated to oc-gateway (:18700)
	ocGone := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		w.Write([]byte(`{"error":"migrated to oc-gateway"}`))
	})

	// Authenticated: cowork
	mux.Handle("GET /api/cowork/container-status", authMiddleware.Authenticate(http.HandlerFunc(containerStatusHandler(s))))
	mux.Handle("POST /api/cowork/provision", authMiddleware.Authenticate(ocGone))

	// Authenticated: cron announce (vm-agent → feishu delivery)
	mux.Handle("POST /api/cron/announce", authMiddleware.Authenticate(http.HandlerFunc(feishuBotHandler.HandleCronAnnounce)))

	// Authenticated: cron job CRUD (sidecar proxy target)
	mux.Handle("POST /api/cron/jobs", authMiddleware.Authenticate(http.HandlerFunc(createCronJobHandler(s))))
	mux.Handle("GET /api/cron/jobs", authMiddleware.Authenticate(http.HandlerFunc(listCronJobsHandler(s))))
	mux.Handle("DELETE /api/cron/jobs/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteCronJobHandler(s))))
	mux.Handle("POST /api/cron/jobs/{id}/run", authMiddleware.Authenticate(http.HandlerFunc(runCronJobHandler())))
	mux.Handle("GET /api/cron/jobs/{id}/history", authMiddleware.Authenticate(http.HandlerFunc(cronJobHistoryHandler())))

	// Games (list is public, deploy/delete require auth)
	mux.HandleFunc("GET /api/games", gamesHandler.List)
	mux.Handle("POST /api/games/deploy", authMiddleware.Authenticate(http.HandlerFunc(gamesHandler.Deploy)))
	mux.Handle("DELETE /api/games/{id}", authMiddleware.Authenticate(http.HandlerFunc(gamesHandler.Delete)))
	feedbackH := http.HandlerFunc(desktopFeedbackHandler(s, ghClient))
	mux.Handle("POST /api/feedback", authMiddleware.Authenticate(feedbackH))
	mux.Handle("POST /api/desktop/feedback", authMiddleware.Authenticate(feedbackH))

	// Desktop ticket endpoint (same ticket store as webchat)
	mux.Handle("POST /api/agent/ws-ticket", authMiddleware.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsTicketStore.IssueTicket(w, r)
		if user := auth.GetUser(r.Context()); user != nil {
			ph.CaptureEvent(user.ID, "ws_ticket_issued", map[string]interface{}{
				"user_name": user.Name,
				"source":    "desktop",
			})
		}
	})))

	// Agent WS/SSE — migrated to oc-gateway
	mux.Handle("POST /api/oc/ws-ticket", authMiddleware.Authenticate(ocGone))
	mux.Handle("GET /ws/oc", ocGone)
	mux.Handle("GET /api/oc/stream", authMiddleware.Authenticate(ocGone))
	mux.Handle("POST /api/oc/send", authMiddleware.Authenticate(ocGone))
	mux.Handle("GET /api/oc/status", authMiddleware.Authenticate(ocGone))

	// User: available teams (templates) — migrated to oc-gateway
	mux.Handle("GET /api/teams", authMiddleware.Authenticate(ocGone))
	mux.Handle("POST /api/teams/install", authMiddleware.Authenticate(ocGone))

	// Admin: container management — migrated to oc-gateway
	mux.Handle("GET /api/admin/containers", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))
	mux.Handle("GET /api/admin/templates", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))
	mux.Handle("POST /api/admin/containers/{id}/start", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))
	mux.Handle("POST /api/admin/containers/{id}/stop", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))
	mux.Handle("POST /api/admin/containers/{id}/sync-config", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))
	mux.Handle("POST /api/admin/containers/{id}/install-template", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))
	mux.Handle("POST /api/admin/containers/{id}/restart", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))

	// Admin: invite codes
	mux.Handle("POST /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(createInviteCodeHandler(s)))))
	mux.Handle("GET /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listInviteCodesHandler(s)))))

	// Admin: settings
	mux.Handle("GET /api/admin/settings", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(getSettingsHandler(s)))))
	mux.Handle("PUT /api/admin/settings", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(updateSettingsHandler(s, cfg, auditLogger, feishuBotClient, ghClient, ph)))))

	// Admin: logs — migrated to oc-gateway
	mux.Handle("GET /api/admin/logs", authMiddleware.Authenticate(authMiddleware.RequireAdmin(ocGone)))

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	// Middleware chain: PanicRecovery → RequestID → RequestLog → CORS → mux
	onError := func(event string, properties map[string]interface{}) {
		ph.CaptureEvent("gateway-server", event, properties)
	}
	handler := middleware.PanicRecoveryWithCallback(
		middleware.RequestID(
			middleware.RequestLogWithCallback(
				corsMiddleware(mux),
				onError,
			),
		),
		onError,
	)

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		log.Info().Str("signal", sig.String()).Msg("shutting down")
		server.Close()
	}()

	log.Info().Str("addr", cfg.Addr()).Msg("starting gateway")
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("server error")
	}
	ph.Close()
}

// --- CORS ---

var allowedOrigins = map[string]bool{
	"http://localhost:1420":    true,
	"tauri://localhost":        true, // macOS WebKit
	"https://tauri.localhost":  true, // Windows WebView2
	"https://jaco.jingao.club": true,
}

func isAllowedOrigin(origin string) bool {
	if allowedOrigins[origin] {
		return true
	}

	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}

	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Cowork-Session, Upgrade")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func meHandler(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":    user.ID,
		"name":  user.Name,
		"email": user.Email,
		"role":  user.Role,
	})
}

func createInviteCodeHandler(s *store.Store) http.HandlerFunc {
	type createRequest struct {
		Role      string `json:"role"`
		MaxUses   int    `json:"max_uses"`
		Note      string `json:"note"`
		ExpiresIn int    `json:"expires_in"` // hours, 0 = never
	}

	return func(w http.ResponseWriter, r *http.Request) {
		admin := auth.GetUser(r.Context())

		var req createRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.Role == "" {
			req.Role = "user"
		}
		if req.MaxUses <= 0 {
			req.MaxUses = 1
		}

		var expiresAt *time.Time
		if req.ExpiresIn > 0 {
			t := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
			expiresAt = &t
		}

		code, err := s.CreateInviteCode(r.Context(), req.Role, admin.ID, req.Note, req.MaxUses, expiresAt)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create invite code"})
			return
		}

		writeJSON(w, http.StatusCreated, code)
	}
}

func listInviteCodesHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codes, err := s.ListInviteCodes(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list invite codes"})
			return
		}
		if codes == nil {
			codes = []store.InviteCode{}
		}
		writeJSON(w, http.StatusOK, codes)
	}
}

func listSessionsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		sessions, err := s.ListSessions(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list sessions"})
			return
		}
		if sessions == nil {
			sessions = []store.SessionSummary{}
		}
		writeJSON(w, http.StatusOK, sessions)
	}
}

func getSessionHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		sess, err := s.GetSession(r.Context(), user.ID, r.PathValue("id"))
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusOK, sess)
	}
}

func createSessionHandler(s *store.Store) http.HandlerFunc {
	type createSessionRequest struct {
		Type          string `json:"type"`
		WorkspacePath string `json:"workspace_path"`
		Model         string `json:"model"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req createSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		sess, err := s.CreateSession(r.Context(), user.ID, req.Type, req.WorkspacePath, req.Model)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create session"})
			return
		}

		writeJSON(w, http.StatusCreated, sess)
	}
}

func updateSessionHandler(s *store.Store) http.HandlerFunc {
	type updateRequest struct {
		Title         *string `json:"title"`
		Messages      *string `json:"messages"`
		Model         *string `json:"model"`
		WorkspacePath *string `json:"workspace_path"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var req updateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		sess, err := s.UpdateSession(r.Context(), user.ID, r.PathValue("id"), store.SessionUpdate{
			Title:         req.Title,
			Messages:      req.Messages,
			Model:         req.Model,
			WorkspacePath: req.WorkspacePath,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusOK, sess)
	}
}

func deleteSessionHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if err := s.DeleteSession(r.Context(), user.ID, r.PathValue("id")); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// containerStatusHandler returns the user's container info (or 404 if none).
func containerStatusHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		containerType := r.URL.Query().Get("container_type")
		if containerType == "" {
			containerType = store.ContainerTypePiVM // historical DB value
		}
		info, err := s.GetContainerInfo(r.Context(), user.ID, containerType)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"provisioned": false,
				"ready":       false,
				"status":      "missing",
			})
			return
		}

		// A container record can exist while async provisioning is still in-flight
		// (status=creating, empty endpoint). Report readiness separately so desktop
		// doesn't start WS handshake too early and end up in reconnect/error loops.
		ready := info.ContainerName != "" && info.Status == "running" && (info.HostPort > 0 || info.ContainerIP != "")
		resp := map[string]interface{}{
			"provisioned":    true,
			"ready":          ready,
			"status":         info.Status,
			"container_name": info.ContainerName,
			"container_ip":   info.ContainerIP,
			"container_type": info.ContainerType,
			"host_port":      info.HostPort,
		}
		if info.ContainerType == store.ContainerTypePiVM { // historical DB value
			resp["container_token"] = info.ContainerToken
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func agentConfigHandler(cfg *config.Config, s agentConfigModelsLister) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, buildAgentConfigResponse(r.Context(), cfg, s))
	}
}

func desktopConfigHandler(cfg *config.Config, s agentConfigModelsLister) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, buildDesktopConfigResponse(r.Context(), cfg, s))
	}
}

func getSettingsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		settings, err := s.GetAllSettings(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load settings"})
			return
		}
		writeJSON(w, http.StatusOK, settings)
	}
}

func updateSettingsHandler(s *store.Store, cfg *config.Config, al *audit.Logger, feishuBot *feishubot.Client, ghClient *github.Client, ph *postHogHolder) http.HandlerFunc {
	type updateRequest struct {
		Settings map[string]string `json:"settings"`
	}

	allowedKeys := map[string]bool{
		"llm_proxy_url":        true,
		"llm_proxy_key":        true,
		"openai_api_key":       true,
		"exa_api_key":          true,
		"tavily_api_key":       true,
		"embedding_base_url":   true,
		"embedding_api_key":    true,
		"fal_api_key":          true,
		"mineru_token":         true,
		"jimeng_api_url":          true,
		"jimeng_api_key":          true,
		"asset_gateway_token":     true,
		"asset_gateway_url":       true,
		"ai_search_gateway_url":   true,
		"ai_search_token":         true,
		"feishu_client_id":        true,
		"feishu_client_secret": true,
		"admin_token":          true,
		"github_token":         true,
		"github_repo":          true,
		"primary_model":        true,
		"primary_provider":     true,
		"posthog_api_key":      true,
		"posthog_endpoint":     true,
		"cli_tools_manifest":   true,
	}

	return func(w http.ResponseWriter, r *http.Request) {
		admin := auth.GetUser(r.Context())
		var req updateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		for key, value := range req.Settings {
			if !allowedKeys[key] {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown setting: " + key})
				return
			}
			if err := s.SetSetting(r.Context(), key, value); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save setting: " + key})
				return
			}
		}

		// Hot-reload: refresh in-memory LLM config from DB
		llm := cfg.GetLLM()
		if v, ok := req.Settings["llm_proxy_url"]; ok && v != "" {
			llm.ProxyURL = v
		}
		if v, ok := req.Settings["llm_proxy_key"]; ok && v != "" {
			llm.ProxyKey = v
		}
		if v, ok := req.Settings["openai_api_key"]; ok {
			llm.OpenAIAPIKey = v
		}
		if v, ok := req.Settings["exa_api_key"]; ok {
			llm.ExaAPIKey = v
		}
		if v, ok := req.Settings["tavily_api_key"]; ok {
			llm.TavilyKey = v
		}
		if v, ok := req.Settings["embedding_base_url"]; ok {
			llm.EmbeddingBaseURL = v
		}
		if v, ok := req.Settings["embedding_api_key"]; ok {
			llm.EmbeddingAPIKey = v
		}
		if v, ok := req.Settings["fal_api_key"]; ok {
			llm.FalAPIKey = v
		}
		if v, ok := req.Settings["mineru_token"]; ok {
			llm.MineruToken = v
		}
		if v, ok := req.Settings["jimeng_api_url"]; ok {
			llm.JimengAPIURL = v
		}
		if v, ok := req.Settings["jimeng_api_key"]; ok {
			llm.JimengAPIKey = v
		}
		if v, ok := req.Settings["asset_gateway_token"]; ok {
			llm.AssetGatewayToken = v
		}
		if v, ok := req.Settings["asset_gateway_url"]; ok {
			llm.AssetGatewayURL = v
		}
		if v, ok := req.Settings["ai_search_gateway_url"]; ok {
			llm.AISearchGatewayURL = v
		}
		if v, ok := req.Settings["ai_search_token"]; ok {
			llm.AISearchToken = v
		}
		if v, ok := req.Settings["primary_model"]; ok {
			llm.PrimaryModel = v
		}
		if v, ok := req.Settings["primary_provider"]; ok {
			llm.PrimaryProvider = v
		}
		cfg.UpdateLLM(llm)

		if v, ok := req.Settings["feishu_client_id"]; ok {
			cfg.Auth.FeishuClientID = v
		}
		if v, ok := req.Settings["feishu_client_secret"]; ok {
			cfg.Auth.FeishuClientSecret = v
		}
		if v, ok := req.Settings["admin_token"]; ok && v != "" {
			cfg.Auth.AdminToken = v
		}
		if v, ok := req.Settings["github_token"]; ok {
			cfg.GitHub.Token = v
		}
		if v, ok := req.Settings["github_repo"]; ok {
			cfg.GitHub.Repo = v
		}
		ghClient.Update(cfg.GitHub.Token, cfg.GitHub.Repo)

		if v, ok := req.Settings["cli_tools_manifest"]; ok {
			cfg.SetCliToolsManifest(v)
		}

		// Hot-reload Feishu Bot credentials
		feishuBot.UpdateCredentials(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret)

		// Hot-reload Goth Feishu SSO provider (re-register with new credentials)
		if cfg.Auth.FeishuClientID != "" && cfg.Auth.FeishuClientSecret != "" {
			baseURL := cfg.Server.PublicURL
			if baseURL == "" {
				baseURL = fmt.Sprintf("http://%s", cfg.Addr())
			}
			callbackURL := baseURL + "/api/auth/feishu/callback"
			goth.UseProviders(feishu.New(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret, callbackURL))
			log.Info().Str("callback", callbackURL).Msg("feishu SSO provider re-registered")
		}

		// Hot-reload PostHog client
		if _, ok := req.Settings["posthog_api_key"]; ok {
			cfg.PostHog.APIKey = req.Settings["posthog_api_key"]
		}
		if v, ok := req.Settings["posthog_endpoint"]; ok {
			cfg.PostHog.Endpoint = v
		}
		if _, ok := req.Settings["posthog_api_key"]; ok {
			ph.Reload(cfg.PostHog.APIKey, cfg.PostHog.Endpoint)
		}

		al.Log(admin.ID, "update_settings", "settings", "", r.RemoteAddr)

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func memorySearchHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "q query parameter is required"})
			return
		}
		limit := 20
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 50 {
				limit = n
			}
		}
		files, err := s.SearchMemoryFiles(r.Context(), user.ID, q, limit)
		if err != nil {
			log.Error().Err(err).Str("user_id", user.ID).Msg("memory search failed")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "memory search failed"})
			return
		}
		hits := make([]map[string]string, 0, len(files))
		for _, f := range files {
			hits = append(hits, map[string]string{
				"path":     f.FilePath,
				"content":  f.Content,
				"checksum": f.Checksum,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
	}
}

func memoryDeleteFileHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		path := strings.TrimSpace(r.URL.Query().Get("path"))
		if path == "" || strings.Contains(path, "..") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid path"})
			return
		}
		if err := s.DeleteMemoryFile(r.Context(), user.ID, filepath.ToSlash(path)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete memory file"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func memoryStatsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		count, totalBytes, err := s.GetMemoryStats(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get memory stats"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"file_count":  count,
			"total_bytes": totalBytes,
		})
	}
}

func memoryClearHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		deleted, err := s.ClearAllMemory(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to clear memory"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{
			"deleted_count": deleted,
		})
	}
}

func memorySyncHandler(s *store.Store) http.HandlerFunc {
	type manifestEntry struct {
		Path     string `json:"path"`
		Checksum string `json:"checksum"`
	}
	type pushEntry struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	type syncRequest struct {
		Manifest []manifestEntry `json:"manifest"`
		Push     []pushEntry     `json:"push"`
	}
	type pullEntry struct {
		Path     string `json:"path"`
		Content  string `json:"content"`
		Checksum string `json:"checksum"`
	}
	type syncResponse struct {
		Pull         []pullEntry `json:"pull"`
		PushAccepted []string    `json:"push_accepted"`
		ServerTime   string      `json:"server_time"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req syncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		clientChecksums := make(map[string]string, len(req.Manifest))
		for _, m := range req.Manifest {
			clientChecksums[m.Path] = m.Checksum
		}

		clientPush := make(map[string]string, len(req.Push))
		for _, p := range req.Push {
			clientPush[p.Path] = p.Content
		}

		serverFiles, err := s.GetMemoryManifest(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load server manifest"})
			return
		}

		serverChecksums := make(map[string]string, len(serverFiles))
		for _, f := range serverFiles {
			serverChecksums[f.FilePath] = f.Checksum
		}

		var pullPaths []string
		pushAccepted := make([]string, 0)

		for _, sf := range serverFiles {
			clientCk, clientHas := clientChecksums[sf.FilePath]
			if clientHas && clientCk == sf.Checksum {
				continue
			}

			if content, pushed := clientPush[sf.FilePath]; pushed {
				merged := content
				if strings.HasPrefix(sf.FilePath, "daily/") && clientCk != sf.Checksum {
					serverWithContent, err := s.GetMemoryFilesByPaths(r.Context(), user.ID, []string{sf.FilePath})
					if err != nil {
						log.Error().Err(err).Str("user_id", user.ID).Str("path", sf.FilePath).Msg("memory sync: load server daily log failed")
						writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load server memory file"})
						return
					}
					if len(serverWithContent) > 0 {
						merged = mergeDailyLogs(serverWithContent[0].Content, content)
					}
				}

				ck := store.ContentChecksum(merged)
				if err := s.UpsertMemoryFile(r.Context(), user.ID, sf.FilePath, merged, ck); err != nil {
					log.Error().Err(err).Str("user_id", user.ID).Str("path", sf.FilePath).Msg("memory sync: upsert merged file failed")
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save merged memory file"})
					return
				}
				pushAccepted = append(pushAccepted, sf.FilePath)
				continue
			}

			pullPaths = append(pullPaths, sf.FilePath)
		}

		for _, p := range req.Push {
			if _, onServer := serverChecksums[p.Path]; onServer {
				continue
			}

			ck := store.ContentChecksum(p.Content)
			if err := s.UpsertMemoryFile(r.Context(), user.ID, p.Path, p.Content, ck); err != nil {
				log.Error().Err(err).Str("user_id", user.ID).Str("path", p.Path).Msg("memory sync: upsert new file failed")
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save new memory file"})
				return
			}
			pushAccepted = append(pushAccepted, p.Path)
		}

		pullFiles := make([]pullEntry, 0)
		if len(pullPaths) > 0 {
			fetched, err := s.GetMemoryFilesByPaths(r.Context(), user.ID, pullPaths)
			if err != nil {
				log.Error().Err(err).Str("user_id", user.ID).Msg("memory sync: fetch pull files failed")
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load pull files"})
				return
			}

			for _, f := range fetched {
				pullFiles = append(pullFiles, pullEntry{
					Path:     f.FilePath,
					Content:  f.Content,
					Checksum: f.Checksum,
				})
			}
		}

		if pushAccepted == nil {
			pushAccepted = []string{}
		}

		writeJSON(w, http.StatusOK, syncResponse{
			Pull:         pullFiles,
			PushAccepted: pushAccepted,
			ServerTime:   time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// mergeDailyLogs combines two daily log contents by deduplicating ## HH:MM entries.
func mergeDailyLogs(serverContent, clientContent string) string {
	type section struct {
		heading string
		body    string
	}

	parseSections := func(content string) []section {
		var sections []section
		lines := strings.Split(content, "\n")
		var current section
		for _, line := range lines {
			if strings.HasPrefix(line, "## ") {
				if current.heading != "" {
					sections = append(sections, current)
				}
				current = section{heading: line, body: ""}
			} else {
				current.body += line + "\n"
			}
		}
		if current.heading != "" {
			sections = append(sections, current)
		}
		return sections
	}

	serverSections := parseSections(serverContent)
	clientSections := parseSections(clientContent)

	seen := make(map[string]bool)
	var merged []section
	for _, s := range serverSections {
		seen[s.heading] = true
		merged = append(merged, s)
	}
	for _, c := range clientSections {
		if !seen[c.heading] {
			merged = append(merged, c)
		}
	}

	sort.Slice(merged, func(i, j int) bool {
		return merged[i].heading < merged[j].heading
	})

	var buf strings.Builder
	for _, s := range merged {
		buf.WriteString(s.heading)
		buf.WriteString("\n")
		buf.WriteString(s.body)
	}
	return strings.TrimRight(buf.String(), "\n") + "\n"
}

func skillsUploadHandler(s *store.Store) http.HandlerFunc {
	type fileEntry struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	type uploadRequest struct {
		Source string      `json:"source"`
		Files  []fileEntry `json:"files"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req uploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.Source != "builtin" && req.Source != "user" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source must be 'builtin' or 'user'"})
			return
		}

		owner := user.ID
		if req.Source == "builtin" {
			owner = "system"
		}

		storeFiles := make([]store.SkillFile, 0, len(req.Files))
		for _, f := range req.Files {
			// Normalize path separators to forward slashes (Windows clients may send \)
			storeFiles = append(storeFiles, store.SkillFile{
				FilePath: filepath.ToSlash(f.Path),
				Content:  f.Content,
				Checksum: store.ContentChecksum(f.Content),
			})
		}

		if err := s.ReplaceSkillFiles(r.Context(), owner, storeFiles); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save skills"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":     "ok",
			"file_count": len(storeFiles),
		})
	}
}

func skillsChecksumHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		checksums, err := s.GetSkillChecksums(r.Context(), []string{"system", user.ID})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get checksums"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"system": checksums["system"],
			"user":   checksums[user.ID],
		})
	}
}

func skillsPullHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		owner := "system"
		switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("owner"))) {
		case "", "system", "builtin":
			owner = "system"
		case "user":
			owner = user.ID
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "owner must be system or user"})
			return
		}

		checksums, err := s.GetSkillChecksums(r.Context(), []string{owner})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get checksums"})
			return
		}
		etag := checksums[owner]

		if etag != "" && r.Header.Get("If-None-Match") == etag {
			if etag != "" {
				w.Header().Set("ETag", etag)
			}
			w.WriteHeader(http.StatusNotModified)
			return
		}

		files, err := s.GetSkillFiles(r.Context(), owner)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load skills"})
			return
		}

		if etag != "" {
			w.Header().Set("ETag", etag)
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"files":    files,
			"checksum": etag,
		})
	}
}

// ─── Skills CRUD handlers ────────────────────────────────

func validateSkillID(skillID string) bool {
	if skillID == "" || len(skillID) > 128 {
		return false
	}
	if strings.Contains(skillID, "..") || strings.Contains(skillID, "/") || strings.Contains(skillID, "\\") {
		return false
	}
	return true
}

func skillsListHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		summaries, err := s.ListSkillSummaries(r.Context(), []string{"system", user.ID})
		if err != nil {
			log.Error().Err(err).Msg("list skill summaries")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list skills"})
			return
		}

		if summaries == nil {
			summaries = []store.SkillSummary{}
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"skills": summaries,
		})
	}
}

func skillsUpsertHandler(s *store.Store) http.HandlerFunc {
	type fileEntry struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	type upsertRequest struct {
		Files []fileEntry `json:"files"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		skillID := r.PathValue("skillId")
		if !validateSkillID(skillID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid skill id"})
			return
		}

		var req upsertRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if len(req.Files) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "files array is required"})
			return
		}

		// Prefix each file path with skillId/
		storeFiles := make([]store.SkillFile, 0, len(req.Files))
		for _, f := range req.Files {
			relPath := filepath.ToSlash(f.Path)
			storeFiles = append(storeFiles, store.SkillFile{
				FilePath: skillID + "/" + relPath,
				Content:  f.Content,
				Checksum: store.ContentChecksum(f.Content),
			})
		}

		if err := s.ReplaceSkillByPrefix(r.Context(), user.ID, skillID, storeFiles); err != nil {
			log.Error().Err(err).Str("skill_id", skillID).Msg("upsert skill")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save skill"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":     "ok",
			"skill_id":   skillID,
			"file_count": len(storeFiles),
		})
	}
}

func skillsDeleteHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		skillID := r.PathValue("skillId")
		if !validateSkillID(skillID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid skill id"})
			return
		}

		if err := s.DeleteSkillByPrefix(r.Context(), user.ID, skillID); err != nil {
			log.Error().Err(err).Str("skill_id", skillID).Msg("delete skill")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete skill"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

// --- Cron Job Handlers ---

func createCronJobHandler(s *store.Store) http.HandlerFunc {
	type createRequest struct {
		ScheduleKind   string  `json:"schedule_kind"`
		ScheduleExpr   string  `json:"schedule_expr"`
		Prompt         string  `json:"prompt"`
		Name           *string `json:"name"`
		SessionTarget  string  `json:"session_target"`
		DeleteAfterRun bool    `json:"delete_after_run"`
		DeliveryMode   *string `json:"delivery_mode"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req createRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.ScheduleKind == "" || req.ScheduleExpr == "" || req.Prompt == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "schedule_kind, schedule_expr, and prompt are required"})
			return
		}

		job, err := s.CreateCronJob(r.Context(), user.ID, req.ScheduleKind, req.ScheduleExpr, req.Prompt, req.Name, req.SessionTarget, req.DeleteAfterRun, req.DeliveryMode)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create cron job"})
			return
		}
		writeJSON(w, http.StatusCreated, job)
	}
}

func listCronJobsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		jobs, err := s.ListCronJobs(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list cron jobs"})
			return
		}
		if jobs == nil {
			jobs = []store.CronJob{}
		}
		writeJSON(w, http.StatusOK, jobs)
	}
}

func deleteCronJobHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if err := s.DeleteCronJob(r.Context(), user.ID, r.PathValue("id")); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "cron job not found"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func runCronJobHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "pending",
			"message": "Gateway-side cron execution not yet implemented. Job is stored and will be executed when the gateway scheduler is built.",
		})
	}
}

func cronJobHistoryHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "pending",
			"message": "No run history available yet. Gateway-side cron execution is not yet implemented.",
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func isTerminal() bool {
	fi, err := os.Stderr.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// posthogCallback logs PostHog event delivery results.
type posthogCallback struct{}

func (c *posthogCallback) Success(msg posthog.APIMessage) {
	log.Info().Str("type", fmt.Sprintf("%T", msg)).Msg("posthog: event delivered")
}

func (c *posthogCallback) Failure(msg posthog.APIMessage, err error) {
	log.Error().Err(err).Str("type", fmt.Sprintf("%T", msg)).Msg("posthog: event delivery failed")
}

// postHogHolder wraps a PostHog client for hot-reload via admin settings.
type postHogHolder struct {
	mu     sync.RWMutex
	client posthog.Client
}

func (h *postHogHolder) Reload(apiKey, endpoint string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.client != nil {
		h.client.Close()
		h.client = nil
	}
	if apiKey == "" {
		log.Info().Msg("posthog client disabled (no api key)")
		return
	}
	opts := posthog.Config{
		Verbose:  true,
		Callback: &posthogCallback{},
	}
	if endpoint != "" {
		opts.Endpoint = endpoint
	}
	c, err := posthog.NewWithConfig(apiKey, opts)
	if err != nil {
		log.Error().Err(err).Msg("posthog client init failed")
		return
	}
	h.client = c
	log.Info().Str("endpoint", endpoint).Msg("posthog client initialized")
}

func (h *postHogHolder) Get() posthog.Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.client
}

// CaptureEvent sends an event to PostHog if the client is initialized.
func (h *postHogHolder) CaptureEvent(distinctID, event string, properties map[string]interface{}) {
	c := h.Get()
	if c == nil {
		return
	}
	props := posthog.NewProperties()
	for k, v := range properties {
		props.Set(k, v)
	}
	if err := c.Enqueue(posthog.Capture{
		DistinctId: distinctID,
		Event:      event,
		Properties: props,
	}); err != nil {
		log.Error().Err(err).Str("event", event).Msg("posthog: enqueue failed")
	} else {
		log.Info().Str("event", event).Msg("posthog: event enqueued")
	}
}

func (h *postHogHolder) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.client != nil {
		h.client.Close()
		h.client = nil
	}
}
