package store

import (
	"bufio"
	"context"
	"strings"
	"time"
)

type SkillFile struct {
	FilePath  string    `json:"file_path"`
	Content   string    `json:"content,omitempty"`
	Checksum  string    `json:"checksum"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetSkillChecksums returns a map of owner → latest checksum for quick comparison.
// Desktop sends its checksum, gateway compares to decide if upload is needed.
func (s *Store) GetSkillChecksums(ctx context.Context, owners []string) (map[string]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT owner, string_agg(checksum, ',' ORDER BY file_path)
		 FROM skill_files WHERE owner = ANY($1) GROUP BY owner`,
		owners)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var owner, aggChecksum string
		if err := rows.Scan(&owner, &aggChecksum); err != nil {
			return nil, err
		}
		// Hash the aggregated checksums to get a single checksum per owner
		result[owner] = ContentChecksum(aggChecksum)
	}
	return result, nil
}

// UpsertSkillFile inserts or updates a single skill file.
func (s *Store) UpsertSkillFile(ctx context.Context, owner, filePath, content, checksum string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO skill_files (owner, file_path, content, checksum)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (owner, file_path)
		 DO UPDATE SET content = $3, checksum = $4, updated_at = now()`,
		owner, filePath, content, checksum)
	return err
}

// ReplaceSkillFiles deletes all files for an owner and inserts new ones (atomic replace).
func (s *Store) ReplaceSkillFiles(ctx context.Context, owner string, files []SkillFile) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM skill_files WHERE owner = $1`, owner)
	if err != nil {
		return err
	}

	for _, f := range files {
		_, err = tx.Exec(ctx,
			`INSERT INTO skill_files (owner, file_path, content, checksum) VALUES ($1, $2, $3, $4)`,
			owner, f.FilePath, f.Content, f.Checksum)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// SkillSummary represents metadata for a single skill (grouped by skillId prefix).
type SkillSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Group       string `json:"group,omitempty"`
	Source      string `json:"source"`   // "builtin" | "user"
	Editable    bool   `json:"editable"` // true for user skills
	FileCount   int    `json:"file_count"`
}

// DeleteSkillByPrefix deletes all files for a skill identified by owner + skillId prefix.
func (s *Store) DeleteSkillByPrefix(ctx context.Context, owner, skillIDPrefix string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM skill_files WHERE owner = $1 AND file_path LIKE $2`,
		owner, skillIDPrefix+"/%")
	return err
}

// ReplaceSkillByPrefix atomically replaces all files for a single skill (by prefix).
// Deletes existing files with the prefix, then inserts new ones.
func (s *Store) ReplaceSkillByPrefix(ctx context.Context, owner, skillIDPrefix string, files []SkillFile) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx,
		`DELETE FROM skill_files WHERE owner = $1 AND file_path LIKE $2`,
		owner, skillIDPrefix+"/%")
	if err != nil {
		return err
	}

	for _, f := range files {
		_, err = tx.Exec(ctx,
			`INSERT INTO skill_files (owner, file_path, content, checksum) VALUES ($1, $2, $3, $4)`,
			owner, f.FilePath, f.Content, f.Checksum)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// ListSkillSummaries returns skill metadata grouped by skillId (first path segment).
// For each group, it looks for SKILL.md and parses YAML frontmatter to extract name/description.
func (s *Store) ListSkillSummaries(ctx context.Context, owners []string) ([]SkillSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT owner, file_path, content FROM skill_files
		 WHERE owner = ANY($1) ORDER BY owner, file_path`,
		owners)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group files by (owner, skillId)
	type groupKey struct {
		owner, skillID string
	}
	type groupData struct {
		fileCount   int
		skillMDBody string // content of SKILL.md if found
	}
	groups := make(map[groupKey]*groupData)
	var order []groupKey

	for rows.Next() {
		var owner, filePath, content string
		if err := rows.Scan(&owner, &filePath, &content); err != nil {
			return nil, err
		}

		parts := strings.SplitN(filePath, "/", 2)
		if len(parts) < 2 {
			continue // skip files without a skill prefix
		}
		skillID := parts[0]
		relPath := parts[1]

		key := groupKey{owner, skillID}
		g, ok := groups[key]
		if !ok {
			g = &groupData{}
			groups[key] = g
			order = append(order, key)
		}
		g.fileCount++

		if strings.EqualFold(relPath, "SKILL.md") {
			g.skillMDBody = content
		}
	}

	var summaries []SkillSummary
	for _, key := range order {
		g := groups[key]
		source := "user"
		if key.owner == "system" {
			source = "builtin"
		}

		name, desc, group := parseSkillFrontmatter(g.skillMDBody)
		if name == "" {
			name = key.skillID
		}

		summaries = append(summaries, SkillSummary{
			ID:          key.skillID,
			Name:        name,
			Description: desc,
			Group:       group,
			Source:       source,
			Editable:    source == "user",
			FileCount:   g.fileCount,
		})
	}

	return summaries, nil
}

// parseSkillFrontmatter extracts name, description, and group from YAML frontmatter in SKILL.md.
// Expected format:
//
//	---
//	name: my-skill
//	description: Does something useful
//	group: tools
//	---
func parseSkillFrontmatter(content string) (name, description, group string) {
	if content == "" {
		return
	}

	scanner := bufio.NewScanner(strings.NewReader(content))
	inFrontmatter := false

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if trimmed == "---" {
			if !inFrontmatter {
				inFrontmatter = true
				continue
			}
			break // end of frontmatter
		}

		if !inFrontmatter {
			continue
		}

		key, val, found := strings.Cut(trimmed, ":")
		if !found {
			continue
		}
		val = strings.TrimSpace(val)
		// Strip surrounding quotes
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}

		switch strings.TrimSpace(key) {
		case "name":
			name = val
		case "description":
			description = val
		case "group":
			group = val
		}
	}
	return
}

// GetSkillFiles returns all skill files for an owner (for container push).
func (s *Store) GetSkillFiles(ctx context.Context, owner string) ([]SkillFile, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT file_path, content, checksum, updated_at FROM skill_files
		 WHERE owner = $1 ORDER BY file_path`,
		owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []SkillFile
	for rows.Next() {
		var f SkillFile
		if err := rows.Scan(&f.FilePath, &f.Content, &f.Checksum, &f.UpdatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}
