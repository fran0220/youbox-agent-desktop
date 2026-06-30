package store

import (
	"context"
	"fmt"
	"time"
)

type LLMProvider struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	DisplayName string    `json:"display_name"`
	APIType     string    `json:"api_type"`
	BaseURL     string    `json:"base_url"`
	APIKeyRef   string    `json:"api_key_ref"`
	Enabled     bool      `json:"enabled"`
	SortOrder   int       `json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type LLMModel struct {
	ID            string    `json:"id"`
	ProviderKey   string    `json:"provider_key"`
	ModelID       string    `json:"model_id"`
	DisplayName   string    `json:"display_name"`
	ContextWindow int       `json:"context_window"`
	MaxTokens     int       `json:"max_tokens"`
	Reasoning     bool      `json:"reasoning"`
	Enabled       bool      `json:"enabled"`
	SortOrder     int       `json:"sort_order"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (s *Store) ListProviders(ctx context.Context) ([]LLMProvider, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, key, display_name, api_type, base_url, api_key_ref, enabled, sort_order, created_at, updated_at
		 FROM llm_providers ORDER BY sort_order, key`)
	if err != nil {
		return nil, fmt.Errorf("list providers: %w", err)
	}
	defer rows.Close()

	var providers []LLMProvider
	for rows.Next() {
		var p LLMProvider
		if err := rows.Scan(&p.ID, &p.Key, &p.DisplayName, &p.APIType, &p.BaseURL, &p.APIKeyRef, &p.Enabled, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan provider: %w", err)
		}
		providers = append(providers, p)
	}
	return providers, nil
}

func (s *Store) GetProvider(ctx context.Context, key string) (*LLMProvider, error) {
	p := &LLMProvider{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, key, display_name, api_type, base_url, api_key_ref, enabled, sort_order, created_at, updated_at
		 FROM llm_providers WHERE key = $1`, key,
	).Scan(&p.ID, &p.Key, &p.DisplayName, &p.APIType, &p.BaseURL, &p.APIKeyRef, &p.Enabled, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get provider %q: %w", key, err)
	}
	return p, nil
}

func (s *Store) UpsertProvider(ctx context.Context, p *LLMProvider) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO llm_providers (key, display_name, api_type, base_url, api_key_ref, enabled, sort_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (key) DO UPDATE SET
		   display_name = EXCLUDED.display_name,
		   api_type = EXCLUDED.api_type,
		   base_url = EXCLUDED.base_url,
		   api_key_ref = EXCLUDED.api_key_ref,
		   enabled = EXCLUDED.enabled,
		   sort_order = EXCLUDED.sort_order`,
		p.Key, p.DisplayName, p.APIType, p.BaseURL, p.APIKeyRef, p.Enabled, p.SortOrder,
	)
	if err != nil {
		return fmt.Errorf("upsert provider %q: %w", p.Key, err)
	}
	return nil
}

func (s *Store) DeleteProvider(ctx context.Context, key string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM llm_providers WHERE key = $1`, key)
	if err != nil {
		return fmt.Errorf("delete provider %q: %w", key, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("provider not found: %s", key)
	}
	return nil
}

func (s *Store) ListModels(ctx context.Context) ([]LLMModel, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, provider_key, model_id, display_name, context_window, max_tokens, reasoning, enabled, sort_order, created_at, updated_at
		 FROM llm_models ORDER BY provider_key, sort_order, model_id`)
	if err != nil {
		return nil, fmt.Errorf("list models: %w", err)
	}
	defer rows.Close()

	var models []LLMModel
	for rows.Next() {
		var m LLMModel
		if err := rows.Scan(&m.ID, &m.ProviderKey, &m.ModelID, &m.DisplayName, &m.ContextWindow, &m.MaxTokens, &m.Reasoning, &m.Enabled, &m.SortOrder, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan model: %w", err)
		}
		models = append(models, m)
	}
	return models, nil
}

func (s *Store) ListModelsByProvider(ctx context.Context, providerKey string) ([]LLMModel, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, provider_key, model_id, display_name, context_window, max_tokens, reasoning, enabled, sort_order, created_at, updated_at
		 FROM llm_models WHERE provider_key = $1 ORDER BY sort_order, model_id`,
		providerKey,
	)
	if err != nil {
		return nil, fmt.Errorf("list models by provider %q: %w", providerKey, err)
	}
	defer rows.Close()

	var models []LLMModel
	for rows.Next() {
		var m LLMModel
		if err := rows.Scan(&m.ID, &m.ProviderKey, &m.ModelID, &m.DisplayName, &m.ContextWindow, &m.MaxTokens, &m.Reasoning, &m.Enabled, &m.SortOrder, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan model: %w", err)
		}
		models = append(models, m)
	}
	return models, nil
}

func (s *Store) UpsertModel(ctx context.Context, m *LLMModel) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO llm_models (provider_key, model_id, display_name, context_window, max_tokens, reasoning, enabled, sort_order)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (provider_key, model_id) DO UPDATE SET
		   display_name = EXCLUDED.display_name,
		   context_window = EXCLUDED.context_window,
		   max_tokens = EXCLUDED.max_tokens,
		   reasoning = EXCLUDED.reasoning,
		   enabled = EXCLUDED.enabled,
		   sort_order = EXCLUDED.sort_order`,
		m.ProviderKey, m.ModelID, m.DisplayName, m.ContextWindow, m.MaxTokens, m.Reasoning, m.Enabled, m.SortOrder,
	)
	if err != nil {
		return fmt.Errorf("upsert model %q/%q: %w", m.ProviderKey, m.ModelID, err)
	}
	return nil
}

func (s *Store) DeleteModel(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM llm_models WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete model %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("model not found: %s", id)
	}
	return nil
}
