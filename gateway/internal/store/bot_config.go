package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"
)

type BotConfig struct {
	PrimaryModel     string `json:"primary_model"`
	CompactionMode   string `json:"compaction_mode"`
	SandboxMode      string `json:"sandbox_mode"`
	SessionResetMode string `json:"session_reset_mode"`
	Workspace        string `json:"workspace"`
}

var defaultBotConfig = BotConfig{
	PrimaryModel:     "proxy/gpt-5.4",
	CompactionMode:   "safeguard",
	SandboxMode:      "off",
	SessionResetMode: "idle",
	Workspace:        "/data/workspace",
}

func (s *Store) GetBotConfig(ctx context.Context, userID, containerType string) (*BotConfig, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(config, '{}'::jsonb) FROM containers WHERE user_id = $1 AND container_type = $2`,
		userID, containerType,
	).Scan(&raw)
	if err != nil {
		return nil, fmt.Errorf("get bot config: %w", err)
	}

	cfg := defaultBotConfig
	if len(raw) > 2 { // not empty "{}"
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return nil, fmt.Errorf("unmarshal bot config: %w", err)
		}
	}
	return &cfg, nil
}

func (s *Store) UpdateBotConfig(ctx context.Context, userID, containerType string, cfg *BotConfig) error {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal bot config: %w", err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))

	_, err = s.pool.Exec(ctx,
		`UPDATE containers SET config = $1::jsonb, desired_config_hash = $2
		 WHERE user_id = $3 AND container_type = $4`,
		raw, hash, userID, containerType,
	)
	if err != nil {
		return fmt.Errorf("update bot config: %w", err)
	}
	return nil
}

func (s *Store) GetContainerTemplate(ctx context.Context, userID, containerType string) (string, error) {
	var templateName string
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(config->>'team_template', '')
		 FROM containers WHERE user_id = $1 AND container_type = $2`,
		userID, containerType,
	).Scan(&templateName)
	if err != nil {
		return "", fmt.Errorf("get container template: %w", err)
	}
	return templateName, nil
}

func (s *Store) SetContainerTemplate(ctx context.Context, userID, containerType, templateName string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE containers
		 SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{team_template}', to_jsonb($1::text), true)
		 WHERE user_id = $2 AND container_type = $3`,
		templateName, userID, containerType,
	)
	if err != nil {
		return fmt.Errorf("set container template: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("container not found for user %s type %s", userID, containerType)
	}
	return nil
}

func (s *Store) UpdateAppliedConfigHash(ctx context.Context, userID, containerType, hash string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE containers SET applied_config_hash = $1, last_synced_at = $2
		 WHERE user_id = $3 AND container_type = $4`,
		hash, time.Now(), userID, containerType,
	)
	if err != nil {
		return fmt.Errorf("update applied config hash: %w", err)
	}
	return nil
}

func (s *Store) UpdatePairingStatus(ctx context.Context, userID, containerType, status, deviceID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE containers SET pairing_status = $1, paired_device_id = $2
		 WHERE user_id = $3 AND container_type = $4`,
		status, deviceID, userID, containerType,
	)
	if err != nil {
		return fmt.Errorf("update pairing status: %w", err)
	}
	return nil
}
