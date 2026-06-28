package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"
)

type MemoryFile struct {
	FilePath  string    `json:"file_path"`
	Content   string    `json:"content,omitempty"`
	Checksum  string    `json:"checksum"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ContentChecksum returns SHA-256[:16] of content, matching vm-agent's VectorStore.contentHash
func ContentChecksum(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:8]) // first 16 hex chars = 8 bytes
}

// GetMemoryManifest returns all memory files for a user (without content, for diff).
func (s *Store) GetMemoryManifest(ctx context.Context, userID string) ([]MemoryFile, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT file_path, checksum, updated_at FROM user_memory WHERE user_id = $1 ORDER BY file_path`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []MemoryFile
	for rows.Next() {
		var f MemoryFile
		if err := rows.Scan(&f.FilePath, &f.Checksum, &f.UpdatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}

// GetMemoryFilesByPaths returns memory files with content for the given paths.
func (s *Store) GetMemoryFilesByPaths(ctx context.Context, userID string, paths []string) ([]MemoryFile, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT file_path, content, checksum, updated_at FROM user_memory
		 WHERE user_id = $1 AND file_path = ANY($2)`,
		userID, paths)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []MemoryFile
	for rows.Next() {
		var f MemoryFile
		if err := rows.Scan(&f.FilePath, &f.Content, &f.Checksum, &f.UpdatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}

// UpsertMemoryFile inserts or updates a memory file.
func (s *Store) UpsertMemoryFile(ctx context.Context, userID, filePath, content, checksum string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO user_memory (user_id, file_path, content, checksum)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, file_path)
		 DO UPDATE SET content = $3, checksum = $4, updated_at = now()`,
		userID, filePath, content, checksum)
	return err
}

// GetMemoryStats returns file count and total bytes for a user's memory.
func (s *Store) GetMemoryStats(ctx context.Context, userID string) (int, int64, error) {
	var count int
	var totalBytes int64
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(OCTET_LENGTH(content)), 0) FROM user_memory WHERE user_id = $1`,
		userID).Scan(&count, &totalBytes)
	return count, totalBytes, err
}

// DeleteMemoryFile removes one memory file for a user.
func (s *Store) DeleteMemoryFile(ctx context.Context, userID, filePath string) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM user_memory WHERE user_id = $1 AND file_path = $2`,
		userID, filePath)
	return err
}

// SearchMemoryFiles finds memory rows matching a query (pg_trgm similarity on content + path).
func (s *Store) SearchMemoryFiles(ctx context.Context, userID, query string, limit int) ([]MemoryFile, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx,
		`SELECT file_path, content, checksum, updated_at FROM user_memory
		 WHERE user_id = $1
		   AND (content % $2 OR file_path % $2 OR content ILIKE '%' || $2 || '%' OR file_path ILIKE '%' || $2 || '%')
		 ORDER BY GREATEST(similarity(content, $2), similarity(file_path, $2)) DESC NULLS LAST, file_path
		 LIMIT $3`,
		userID, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var files []MemoryFile
	for rows.Next() {
		var f MemoryFile
		if err := rows.Scan(&f.FilePath, &f.Content, &f.Checksum, &f.UpdatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}

// ClearAllMemory deletes all memory files for a user, returns affected rows.
func (s *Store) ClearAllMemory(ctx context.Context, userID string) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM user_memory WHERE user_id = $1`,
		userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// GetAllMemoryFiles returns all memory files with content for a user (for container push).
func (s *Store) GetAllMemoryFiles(ctx context.Context, userID string) ([]MemoryFile, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT file_path, content, checksum, updated_at FROM user_memory
		 WHERE user_id = $1 ORDER BY file_path`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []MemoryFile
	for rows.Next() {
		var f MemoryFile
		if err := rows.Scan(&f.FilePath, &f.Content, &f.Checksum, &f.UpdatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}
