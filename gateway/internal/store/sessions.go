package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type ChatSession struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Title         string          `json:"title"`
	Type          string          `json:"type"`
	Model         string          `json:"model"`
	WorkspacePath string          `json:"workspace_path"`
	Messages      json.RawMessage `json:"messages"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type SessionSummary struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Type          string    `json:"type"`
	Model         string    `json:"model"`
	WorkspacePath string    `json:"workspace_path"`
	MessageCount  int       `json:"message_count"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (s *Store) ListSessions(ctx context.Context, userID string) ([]SessionSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, title, type, model, workspace_path, jsonb_array_length(messages), created_at, updated_at
		 FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []SessionSummary
	for rows.Next() {
		var ss SessionSummary
		if err := rows.Scan(&ss.ID, &ss.Title, &ss.Type, &ss.Model, &ss.WorkspacePath, &ss.MessageCount, &ss.CreatedAt, &ss.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, ss)
	}
	return sessions, nil
}

func (s *Store) GetSession(ctx context.Context, userID, sessionID string) (*ChatSession, error) {
	sess := &ChatSession{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, title, type, model, workspace_path, messages, created_at, updated_at
		 FROM chat_sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Type, &sess.Model, &sess.WorkspacePath, &sess.Messages, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return sess, nil
}

// UpsertSessionMetadata ensures a chat_sessions row exists for the user, then applies
// partial metadata updates using the same semantics as UpdateSession (non-empty title/messages only).
func (s *Store) UpsertSessionMetadata(ctx context.Context, userID, sessionID, sessionType string, upd SessionUpdate) (*ChatSession, error) {
	if sessionType == "" {
		sessionType = "chat"
	}
	if _, err := s.GetSession(ctx, userID, sessionID); err == nil {
		return s.UpdateSession(ctx, userID, sessionID, upd)
	}
	return s.CreateSessionWithID(ctx, userID, sessionID, sessionType, upd)
}

func (s *Store) CreateSessionWithID(ctx context.Context, userID, sessionID, sessionType string, meta SessionUpdate) (*ChatSession, error) {
	if sessionType == "" {
		sessionType = "chat"
	}
	title := ""
	if meta.Title != nil {
		title = *meta.Title
	}
	model := ""
	if meta.Model != nil {
		model = *meta.Model
	}
	workspacePath := ""
	if meta.WorkspacePath != nil {
		workspacePath = *meta.WorkspacePath
	}

	sess := &ChatSession{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO chat_sessions (id, user_id, type, workspace_path, model, title, messages)
		 VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
		 RETURNING id, user_id, title, type, model, workspace_path, messages, created_at, updated_at`,
		sessionID, userID, sessionType, workspacePath, model, title,
	).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Type, &sess.Model, &sess.WorkspacePath, &sess.Messages, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create session with id: %w", err)
	}
	return sess, nil
}

func (s *Store) CreateSession(ctx context.Context, userID, sessionType, workspacePath, model string) (*ChatSession, error) {
	if sessionType == "" {
		sessionType = "chat"
	}

	sess := &ChatSession{}
	var err error
	if strings.TrimSpace(model) == "" {
		err = s.pool.QueryRow(ctx,
			`INSERT INTO chat_sessions (user_id, type, workspace_path)
			 VALUES ($1, $2, $3)
			 RETURNING id, user_id, title, type, model, workspace_path, messages, created_at, updated_at`,
			userID, sessionType, workspacePath,
		).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Type, &sess.Model, &sess.WorkspacePath, &sess.Messages, &sess.CreatedAt, &sess.UpdatedAt)
	} else {
		err = s.pool.QueryRow(ctx,
			`INSERT INTO chat_sessions (user_id, type, workspace_path, model)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, user_id, title, type, model, workspace_path, messages, created_at, updated_at`,
			userID, sessionType, workspacePath, model,
		).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Type, &sess.Model, &sess.WorkspacePath, &sess.Messages, &sess.CreatedAt, &sess.UpdatedAt)
	}
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return sess, nil
}

type SessionUpdate struct {
	Title         *string
	Messages      *string
	Model         *string
	WorkspacePath *string
}

func (s *Store) UpdateSession(ctx context.Context, userID, sessionID string, upd SessionUpdate) (*ChatSession, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if upd.Title != nil && *upd.Title != "" {
		setClauses = append(setClauses, fmt.Sprintf("title = $%d", argIdx))
		args = append(args, *upd.Title)
		argIdx++
	}
	if upd.Messages != nil && *upd.Messages != "" {
		setClauses = append(setClauses, fmt.Sprintf("messages = $%d::jsonb", argIdx))
		args = append(args, *upd.Messages)
		argIdx++
	}
	if upd.Model != nil {
		setClauses = append(setClauses, fmt.Sprintf("model = $%d", argIdx))
		args = append(args, *upd.Model)
		argIdx++
	}
	if upd.WorkspacePath != nil {
		setClauses = append(setClauses, fmt.Sprintf("workspace_path = $%d", argIdx))
		args = append(args, *upd.WorkspacePath)
		argIdx++
	}

	if len(setClauses) > 0 {
		query := fmt.Sprintf(
			"UPDATE chat_sessions SET %s WHERE id = $%d AND user_id = $%d",
			joinStrings(setClauses, ", "), argIdx, argIdx+1,
		)
		args = append(args, sessionID, userID)
		_, err := s.pool.Exec(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	}

	return s.GetSession(ctx, userID, sessionID)
}

func joinStrings(s []string, sep string) string {
	result := ""
	for i, v := range s {
		if i > 0 {
			result += sep
		}
		result += v
	}
	return result
}

func (s *Store) DeleteSession(ctx context.Context, userID, sessionID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session not found")
	}
	return nil
}
