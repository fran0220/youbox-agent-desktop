package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type AgentAvatar struct {
	ID        string            `json:"id"`
	UserID    *string           `json:"user_id"`
	AgentRole string            `json:"agent_role"`
	ModelURL  string            `json:"model_url"`
	AnimURLs  map[string]string `json:"anim_urls"`
	Style     string            `json:"style"`
	Source    string            `json:"source"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

func (s *Store) ListAvatars(ctx context.Context, userID string) ([]AgentAvatar, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, agent_role, model_url, anim_urls, style, source, created_at, updated_at
		 FROM agent_avatars
		 WHERE user_id = $1 OR user_id IS NULL
		 ORDER BY user_id NULLS LAST, agent_role`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list avatars: %w", err)
	}
	defer rows.Close()

	var avatars []AgentAvatar
	for rows.Next() {
		var a AgentAvatar
		var animRaw []byte
		if err := rows.Scan(&a.ID, &a.UserID, &a.AgentRole, &a.ModelURL, &animRaw, &a.Style, &a.Source, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan avatar: %w", err)
		}
		if err := json.Unmarshal(animRaw, &a.AnimURLs); err != nil {
			a.AnimURLs = map[string]string{}
		}
		avatars = append(avatars, a)
	}
	return avatars, nil
}

func (s *Store) GetAvatar(ctx context.Context, userID, agentRole string) (*AgentAvatar, error) {
	var a AgentAvatar
	var animRaw []byte
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, agent_role, model_url, anim_urls, style, source, created_at, updated_at
		 FROM agent_avatars
		 WHERE (user_id = $1 OR user_id IS NULL) AND agent_role = $2
		 ORDER BY user_id NULLS LAST
		 LIMIT 1`,
		userID, agentRole,
	).Scan(&a.ID, &a.UserID, &a.AgentRole, &a.ModelURL, &animRaw, &a.Style, &a.Source, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get avatar: %w", err)
	}
	if err := json.Unmarshal(animRaw, &a.AnimURLs); err != nil {
		a.AnimURLs = map[string]string{}
	}
	return &a, nil
}

func (s *Store) UpsertAvatar(ctx context.Context, userID, agentRole, modelURL string, animURLs map[string]string, style, source string) (*AgentAvatar, error) {
	animJSON, err := json.Marshal(animURLs)
	if err != nil {
		return nil, fmt.Errorf("marshal anim_urls: %w", err)
	}

	var a AgentAvatar
	var animRaw []byte
	err = s.pool.QueryRow(ctx,
		`INSERT INTO agent_avatars (user_id, agent_role, model_url, anim_urls, style, source)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, agent_role) WHERE user_id IS NOT NULL
		 DO UPDATE SET model_url = EXCLUDED.model_url, anim_urls = EXCLUDED.anim_urls,
		              style = EXCLUDED.style, source = EXCLUDED.source
		 RETURNING id, user_id, agent_role, model_url, anim_urls, style, source, created_at, updated_at`,
		userID, agentRole, modelURL, animJSON, style, source,
	).Scan(&a.ID, &a.UserID, &a.AgentRole, &a.ModelURL, &animRaw, &a.Style, &a.Source, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert avatar: %w", err)
	}
	if err := json.Unmarshal(animRaw, &a.AnimURLs); err != nil {
		a.AnimURLs = map[string]string{}
	}
	return &a, nil
}

func (s *Store) DeleteAvatar(ctx context.Context, userID, agentRole string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM agent_avatars WHERE user_id = $1 AND agent_role = $2`,
		userID, agentRole,
	)
	if err != nil {
		return fmt.Errorf("delete avatar: %w", err)
	}
	return nil
}
