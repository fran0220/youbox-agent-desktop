package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type AgentProfile struct {
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	DisplayName string            `json:"displayName"`
	Description string            `json:"description"`
	Icon        string            `json:"icon"`
	Model       string            `json:"model"`
	Skills      []string          `json:"skills"`
	Workspace   string            `json:"workspace"`
	Files       map[string]string `json:"files"`
	CreatedAt   time.Time         `json:"created_at,omitempty"`
	UpdatedAt   time.Time         `json:"updated_at,omitempty"`
}

type AgentProfileSummary struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	SessionKey  string `json:"sessionKey"`
}

var ErrAgentProfileNotFound = fmt.Errorf("agent profile not found")

func (s *Store) ListAgentProfiles(ctx context.Context, userID string) ([]AgentProfileSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT name, display_name, description, icon, workspace
		 FROM agent_profiles
		 WHERE user_id = $1
		 ORDER BY name ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list agent profiles: %w", err)
	}
	defer rows.Close()

	var profiles []AgentProfileSummary
	for rows.Next() {
		var name string
		var displayName string
		var description string
		var icon string
		var workspace string
		if err := rows.Scan(&name, &displayName, &description, &icon, &workspace); err != nil {
			return nil, fmt.Errorf("scan agent profile summary: %w", err)
		}
		profiles = append(profiles, AgentProfileSummary{
			Type:        "agent",
			Name:        name,
			DisplayName: displayName,
			Description: description,
			Icon:        icon,
			SessionKey:  normalizeProfileSessionKey(name, workspace),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent profiles: %w", err)
	}
	return profiles, nil
}

func (s *Store) GetAgentProfile(ctx context.Context, userID, name string) (*AgentProfile, error) {
	profile := &AgentProfile{}
	var skillsRaw []byte
	var filesRaw []byte
	err := s.pool.QueryRow(ctx,
		`SELECT name, display_name, description, icon, model, skills, workspace, files, created_at, updated_at
		 FROM agent_profiles
		 WHERE user_id = $1 AND name = $2`,
		userID, name,
	).Scan(
		&profile.Name, &profile.DisplayName, &profile.Description, &profile.Icon, &profile.Model, &skillsRaw, &profile.Workspace, &filesRaw, &profile.CreatedAt, &profile.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrAgentProfileNotFound
		}
		return nil, fmt.Errorf("get agent profile: %w", err)
	}
	if err := decodeProfileJSON(profile, skillsRaw, filesRaw); err != nil {
		return nil, err
	}
	return profile, nil
}

func (s *Store) CreateAgentProfile(ctx context.Context, userID string, profile AgentProfile) error {
	skillsJSON, filesJSON, err := encodeProfileJSON(profile.Skills, profile.Files)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO agent_profiles (user_id, name, display_name, description, icon, model, skills, workspace, files)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
		userID, profile.Name, profile.DisplayName, profile.Description, profile.Icon, profile.Model, skillsJSON, profile.Workspace, filesJSON,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fmt.Errorf("agent profile already exists")
		}
		return fmt.Errorf("create agent profile: %w", err)
	}
	return nil
}

func (s *Store) UpdateAgentProfile(ctx context.Context, userID, name string, profile AgentProfile) error {
	skillsJSON, filesJSON, err := encodeProfileJSON(profile.Skills, profile.Files)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE agent_profiles
		 SET display_name = $3, description = $4, icon = $5, model = $6, skills = $7::jsonb, workspace = $8, files = $9::jsonb
		 WHERE user_id = $1 AND name = $2`,
		userID, name, profile.DisplayName, profile.Description, profile.Icon, profile.Model, skillsJSON, profile.Workspace, filesJSON,
	)
	if err != nil {
		return fmt.Errorf("update agent profile: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAgentProfileNotFound
	}
	return nil
}

func (s *Store) DeleteAgentProfile(ctx context.Context, userID, name string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM agent_profiles WHERE user_id = $1 AND name = $2`,
		userID, name,
	)
	if err != nil {
		return fmt.Errorf("delete agent profile: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAgentProfileNotFound
	}
	return nil
}

func decodeProfileJSON(profile *AgentProfile, skillsRaw, filesRaw []byte) error {
	profile.Type = "agent"
	profile.Name = strings.TrimSpace(profile.Name)
	profile.DisplayName = strings.TrimSpace(profile.DisplayName)
	profile.Description = strings.TrimSpace(profile.Description)
	profile.Icon = strings.TrimSpace(profile.Icon)
	profile.Model = strings.TrimSpace(profile.Model)
	profile.Workspace = strings.TrimSpace(profile.Workspace)
	if profile.Icon == "" {
		profile.Icon = "bot"
	}
	if profile.DisplayName == "" {
		profile.DisplayName = profile.Name
	}

	var skills []string
	if len(skillsRaw) > 0 {
		if err := json.Unmarshal(skillsRaw, &skills); err != nil {
			return fmt.Errorf("decode agent profile skills: %w", err)
		}
	}
	profile.Skills = normalizeSkillList(skills)

	files := map[string]string{}
	if len(filesRaw) > 0 {
		if err := json.Unmarshal(filesRaw, &files); err != nil {
			return fmt.Errorf("decode agent profile files: %w", err)
		}
	}
	profile.Files = normalizeFiles(files)
	return nil
}

func encodeProfileJSON(skills []string, files map[string]string) ([]byte, []byte, error) {
	skills = normalizeSkillList(skills)
	files = normalizeFiles(files)

	skillsJSON, err := json.Marshal(skills)
	if err != nil {
		return nil, nil, fmt.Errorf("encode agent profile skills: %w", err)
	}
	filesJSON, err := json.Marshal(files)
	if err != nil {
		return nil, nil, fmt.Errorf("encode agent profile files: %w", err)
	}
	return skillsJSON, filesJSON, nil
}

func normalizeProfileSessionKey(name, workspace string) string {
	workspace = strings.TrimSpace(workspace)
	if workspace != "" {
		return workspace
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "agent:default:main"
	}
	return "agent:" + name + ":main"
}

func normalizeSkillList(skills []string) []string {
	if len(skills) == 0 {
		return []string{}
	}
	normalized := make([]string, 0, len(skills))
	seen := map[string]struct{}{}
	for _, skill := range skills {
		trimmed := strings.TrimSpace(skill)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

func normalizeFiles(files map[string]string) map[string]string {
	if len(files) == 0 {
		return map[string]string{}
	}
	normalized := make(map[string]string, len(files))
	for key, value := range files {
		k := strings.TrimSpace(key)
		if k == "" {
			continue
		}
		normalized[k] = value
	}
	return normalized
}
