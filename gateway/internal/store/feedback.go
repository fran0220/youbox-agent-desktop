package store

import (
	"context"
	"fmt"
)

// InsertFeedback persists a desktop feedback row for the authenticated user.
func (s *Store) InsertFeedback(ctx context.Context, name, email, category, message, appVersion string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO feedback (id, name, email, category, message, app_version, status, created_at, updated_at)
		 VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'open', now(), now())`,
		name, email, category, message, appVersion,
	)
	if err != nil {
		return fmt.Errorf("insert feedback: %w", err)
	}
	return nil
}
