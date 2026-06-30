package feishubot

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	maxReplyLength     = 3000
	responseTimeout    = 120 * time.Second
	dedupTTL           = 30 * time.Minute
	dedupCleanInterval = 10 * time.Minute
)

var mentionPattern = regexp.MustCompile(`@_user_\d+\s*`)

// imageAttachment holds downloaded image data for inline inclusion in agent prompts.
type imageAttachment struct {
	URL string // descriptive label (e.g. image_key + extension)
}

// Handler processes Feishu webhook events and routes messages to Pi VMs
// via oc-gateway HTTP proxy, enabling conversation sync with webchat.
type Handler struct {
	client *Client
	store  *store.Store

	// ocGatewayURL is the base URL of oc-gateway for proxying chat messages.
	ocGatewayURL string
	httpClient   *http.Client

	chatLocks       sync.Map // userID → *sync.Mutex (single-flight per user)
	processedEvents sync.Map // event_id → time.Time (webhook dedup)
}

func NewHandler(client *Client, s *store.Store) *Handler {
	h := &Handler{
		client:     client,
		store:      s,
		httpClient: &http.Client{Timeout: responseTimeout},
	}
	go h.cleanupLoop()
	return h
}

// SetOcGatewayURL configures the oc-gateway URL for proxying feishu chat messages.
func (h *Handler) SetOcGatewayURL(url string) {
	h.ocGatewayURL = strings.TrimRight(url, "/")
}

// --- Feishu event structures ---

type feishuEvent struct {
	Schema string          `json:"schema"`
	Header feishuHeader    `json:"header"`
	Event  json.RawMessage `json:"event"`
	// url_verification fields
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
}

type feishuHeader struct {
	EventID   string `json:"event_id"`
	EventType string `json:"event_type"`
	Token     string `json:"token"`
	AppID     string `json:"app_id"`
}

type messageEvent struct {
	Sender struct {
		SenderID struct {
			OpenID string `json:"open_id"`
		} `json:"sender_id"`
		SenderType string `json:"sender_type"`
	} `json:"sender"`
	Message struct {
		MessageID   string `json:"message_id"`
		ChatType    string `json:"chat_type"`
		MessageType string `json:"message_type"`
		Content     string `json:"content"`
	} `json:"message"`
}

// --- Webhook handler ---

func (h *Handler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body failed"})
		return
	}

	var event feishuEvent
	if err := json.Unmarshal(body, &event); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	// URL verification challenge
	if event.Type == "url_verification" {
		writeJSON(w, http.StatusOK, map[string]string{"challenge": event.Challenge})
		log.Info().Str("challenge", event.Challenge).Msg("feishu webhook: url verification")
		return
	}

	// Respond immediately (Feishu requires < 3s)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})

	// Deduplicate
	if event.Header.EventID != "" {
		if _, loaded := h.processedEvents.LoadOrStore(event.Header.EventID, time.Now()); loaded {
			log.Debug().Str("event_id", event.Header.EventID).Msg("feishu webhook: duplicate, skipping")
			return
		}
	}

	switch event.Header.EventType {
	case "im.message.receive_v1":
		go h.handleMessage(event.Event)
	default:
		log.Info().Str("event_type", event.Header.EventType).Msg("feishu webhook: unhandled event type")
	}
}

// ChatProxyRequest is sent by the gateway to proxy feishu messages to oc-gateway.
type ChatProxyRequest struct {
	UserID     string `json:"user_id"`
	OpenID     string `json:"open_id"`
	MessageID  string `json:"message_id"`
	Text       string `json:"text"`
	SessionKey string `json:"session_key,omitempty"`
}

// ChatProxyResponse is returned to the gateway.
type ChatProxyResponse struct {
	Response string `json:"response"`
	Error    string `json:"error,omitempty"`
}

// --- Message processing (runs async in goroutine) ---

func (h *Handler) handleMessage(raw json.RawMessage) {
	var msg messageEvent
	if err := json.Unmarshal(raw, &msg); err != nil {
		log.Error().Err(err).Msg("feishu bot: parse message event failed")
		return
	}

	openID := msg.Sender.SenderID.OpenID
	messageID := msg.Message.MessageID

	log.Info().
		Str("open_id", openID).
		Str("message_id", messageID).
		Str("chat_type", msg.Message.ChatType).
		Str("message_type", msg.Message.MessageType).
		Msg("feishu bot: received message")

	if !h.client.IsConfigured() {
		log.Warn().Msg("feishu bot: credentials not configured, ignoring message")
		return
	}

	// Handle supported message types
	var text string
	var attachments []imageAttachment

	switch msg.Message.MessageType {
	case "text":
		var content struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(msg.Message.Content), &content); err != nil {
			log.Error().Err(err).Str("content", msg.Message.Content).Msg("feishu bot: parse text failed")
			h.client.ReplyText(messageID, "消息解析失败，请重试")
			return
		}
		text = mentionPattern.ReplaceAllString(content.Text, "")
		text = strings.TrimSpace(text)

	case "image":
		var content struct {
			ImageKey string `json:"image_key"`
		}
		if err := json.Unmarshal([]byte(msg.Message.Content), &content); err != nil {
			log.Error().Err(err).Str("content", msg.Message.Content).Msg("feishu bot: parse image content failed")
			h.client.ReplyText(messageID, "图片解析失败，请重试")
			return
		}
		imgData, err := h.client.DownloadImage(messageID, content.ImageKey)
		if err != nil {
			log.Error().Err(err).Str("image_key", content.ImageKey).Msg("feishu bot: download image failed")
			h.client.ReplyText(messageID, "图片下载失败，请重试")
			return
		}
		mimeType := http.DetectContentType(imgData)
		attachments = append(attachments, imageAttachment{
			URL: content.ImageKey + mimeExtension(mimeType),
		})
		text = "请查看这张图片"
		log.Info().Str("image_key", content.ImageKey).Int("size", len(imgData)).Str("mime", mimeType).Msg("feishu bot: image downloaded")

	default:
		h.client.ReplyText(messageID, "暂时只支持文字和图片消息哦 🙂")
		return
	}

	if text == "" && len(attachments) == 0 {
		return
	}

	// Look up user by feishu open_id
	ctx := context.Background()
	user, err := h.store.GetUserByFeishuID(ctx, openID)
	if err != nil {
		log.Warn().Str("open_id", openID).Msg("feishu bot: user not found")
		h.client.ReplyText(messageID, "您尚未绑定 JAcoworks 账号。请先通过飞书 SSO 登录桌面端完成绑定。")
		return
	}

	// Single-flight: one chat at a time per user
	lock := h.getChatLock(user.ID)
	lock.Lock()
	defer lock.Unlock()

	// Build the full message text (with image labels if any)
	actualMessage := text
	if len(attachments) > 0 {
		var sb strings.Builder
		sb.WriteString(text)
		for _, att := range attachments {
			sb.WriteString(fmt.Sprintf("\n[图片: %s]", att.URL))
		}
		actualMessage = sb.String()
	}

	response, err := h.routeViaOcGateway(user.ID, openID, messageID, actualMessage)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("feishu bot: route failed")
		h.client.ReplyText(messageID, "AI 处理消息时出错，请稍后重试。")
		return
	}

	// Truncate if too long
	if len(response) > maxReplyLength {
		response = response[:maxReplyLength] + "\n\n…(内容过长已截断)"
	}

	// Reply via Feishu
	if err := h.client.ReplyText(messageID, response); err != nil {
		log.Error().Err(err).Str("message_id", messageID).Msg("feishu bot: reply failed, trying send")
		if err := h.client.SendText(openID, response); err != nil {
			log.Error().Err(err).Str("open_id", openID).Msg("feishu bot: send fallback failed")
		}
	}

	log.Info().
		Str("user_id", user.ID).
		Str("open_id", openID).
		Int("response_len", len(response)).
		Msg("feishu bot: replied")
}

// --- OC-Gateway proxy routing ---

// routeViaOcGateway forwards the Feishu message to oc-gateway's /api/feishu/chat
// endpoint, which owns the Pi relay and runtime connection logic.
func (h *Handler) routeViaOcGateway(userID, openID, messageID, text string) (string, error) {
	proxyReq := ChatProxyRequest{
		UserID:    userID,
		OpenID:    openID,
		MessageID: messageID,
		Text:      text,
	}

	body, _ := json.Marshal(proxyReq)
	url := h.ocGatewayURL + "/api/feishu/chat"

	log.Info().Str("url", url).Str("user_id", userID).Msg("feishu bot: proxying to oc-gateway")

	resp, err := h.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("proxy to oc-gateway: %w", err)
	}
	defer resp.Body.Close()

	var proxyResp ChatProxyResponse
	if err := json.NewDecoder(resp.Body).Decode(&proxyResp); err != nil {
		return "", fmt.Errorf("decode oc-gateway response: %w", err)
	}

	if resp.StatusCode != http.StatusOK || proxyResp.Error != "" {
		errMsg := proxyResp.Error
		if errMsg == "" {
			errMsg = fmt.Sprintf("oc-gateway returned %d", resp.StatusCode)
		}
		return "", fmt.Errorf("oc-gateway error: %s", errMsg)
	}

	return proxyResp.Response, nil
}

// --- DB session sync ---

// syncSessionMessages appends the user message and assistant reply to the user's
// cowork session in the database, so the desktop can see feishu conversations.
func (h *Handler) syncSessionMessages(ctx context.Context, userID, userMessage, assistantReply string) {
	if assistantReply == "" {
		return
	}

	sessionID, err := h.findOrCreateCoworkSession(ctx, userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("feishu bot: session sync failed")
		return
	}

	sess, err := h.store.GetSession(ctx, userID, sessionID)
	if err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("feishu bot: get session failed")
		return
	}

	var messages []map[string]interface{}
	if len(sess.Messages) > 0 {
		_ = json.Unmarshal(sess.Messages, &messages)
	}

	now := time.Now().UnixMilli()
	messages = append(messages,
		map[string]interface{}{
			"id": generateMsgID(), "role": "user",
			"content": userMessage, "createdAt": now, "status": "final",
		},
		map[string]interface{}{
			"id": generateMsgID(), "role": "assistant",
			"content": assistantReply, "createdAt": now, "status": "final",
		},
	)

	msgJSON, _ := json.Marshal(messages)
	msgStr := string(msgJSON)

	title := sess.Title
	if title == "" || title == "新对话" || title == "新会话" {
		title = truncateTitle(userMessage)
	}

	if _, err := h.store.UpdateSession(ctx, userID, sessionID, store.SessionUpdate{
		Messages: &msgStr,
		Title:    &title,
	}); err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("feishu bot: save messages failed")
	}
}

func (h *Handler) findOrCreateCoworkSession(ctx context.Context, userID string) (string, error) {
	sessions, err := h.store.ListSessions(ctx, userID)
	if err != nil {
		return "", err
	}

	for _, s := range sessions {
		if s.Type == "cowork" {
			return s.ID, nil
		}
	}

	sess, err := h.store.CreateSession(ctx, userID, "cowork", "", "")
	if err != nil {
		return "", err
	}
	return sess.ID, nil
}

// --- Cron announce delivery ---

// CronAnnounceRequest is the payload sent by agent runtimes when a cron job completes.
type CronAnnounceRequest struct {
	JobID         string `json:"jobId"`
	JobName       string `json:"jobName,omitempty"`
	Status        string `json:"status"`
	DurationMs    int64  `json:"durationMs"`
	ResultPreview string `json:"resultPreview,omitempty"`
	Error         string `json:"error,omitempty"`
}

// HandleCronAnnounce receives a cron result and delivers it to the user's Feishu account.
func (h *Handler) HandleCronAnnounce(w http.ResponseWriter, r *http.Request) {
	if !h.client.IsConfigured() {
		writeJSON(w, http.StatusOK, map[string]string{"status": "skipped", "reason": "feishu not configured"})
		return
	}

	var req CronAnnounceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	userInfo := auth.GetUser(r.Context())
	if userInfo == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	ctx := r.Context()
	user, err := h.store.GetUserByID(ctx, userInfo.ID)
	if err != nil || user.FeishuOpenID == nil || *user.FeishuOpenID == "" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "skipped", "reason": "user has no feishu binding"})
		return
	}

	name := req.JobName
	if name == "" {
		name = req.JobID
	}

	var text string
	if req.Status == "ok" {
		text = fmt.Sprintf("⏰ 定时任务 [%s] 完成 (%dms)", name, req.DurationMs)
		if req.ResultPreview != "" {
			preview := req.ResultPreview
			if len(preview) > 500 {
				preview = preview[:500] + "…"
			}
			text += "\n\n" + preview
		}
	} else {
		text = fmt.Sprintf("⏰ 定时任务 [%s] 失败 (%dms)", name, req.DurationMs)
		if req.Error != "" {
			text += "\n错误: " + req.Error
		}
	}

	if err := h.client.SendText(*user.FeishuOpenID, text); err != nil {
		log.Error().Err(err).Str("user_id", userInfo.ID).Str("job_id", req.JobID).Msg("feishu bot: cron announce failed")
		writeJSON(w, http.StatusOK, map[string]string{"status": "error", "reason": err.Error()})
		return
	}

	log.Info().Str("user_id", userInfo.ID).Str("job_id", req.JobID).Str("status", req.Status).Msg("feishu bot: cron announced")
	writeJSON(w, http.StatusOK, map[string]string{"status": "delivered"})
}

// --- Helpers ---

func (h *Handler) getChatLock(userID string) *sync.Mutex {
	v, _ := h.chatLocks.LoadOrStore(userID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

func (h *Handler) cleanupLoop() {
	ticker := time.NewTicker(dedupCleanInterval)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-dedupTTL)
		h.processedEvents.Range(func(key, value interface{}) bool {
			if t, ok := value.(time.Time); ok && t.Before(cutoff) {
				h.processedEvents.Delete(key)
			}
			return true
		})
	}
}

func generateRequestID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "feishu-" + hex.EncodeToString(b)
}

func generateMsgID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func truncateTitle(text string) string {
	cleaned := strings.NewReplacer("\n", " ", "*", "", "_", "", "~", "", "`", "", "#", "").Replace(text)
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return "飞书对话"
	}
	runes := []rune(cleaned)
	if len(runes) <= 20 {
		return cleaned
	}
	return string(runes[:20]) + "..."
}

func mimeExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".bin"
	}
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
