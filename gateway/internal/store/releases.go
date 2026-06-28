package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ReleaseAsset is a platform-specific download for a release.
type ReleaseAsset struct {
	Platform    string `json:"platform"`
	DownloadURL string `json:"download_url"`
	Signature   string `json:"signature,omitempty"`
	FileSize    int64  `json:"file_size,omitempty"`
}

// DesktopRelease is the latest release payload for GET /api/desktop/release/latest.
type DesktopRelease struct {
	Version string         `json:"version"`
	Notes   string         `json:"notes,omitempty"`
	PubDate time.Time      `json:"pub_date"`
	Assets  []ReleaseAsset `json:"assets"`
}

// GetLatestDesktopRelease returns the newest release row that has at least one asset.
// Ordering: is_latest first, then pub_date, then created_at (all descending).
func (s *Store) GetLatestDesktopRelease(ctx context.Context) (*DesktopRelease, error) {
	var releaseID, version, notes string
	var pubDate time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT r.id, r.version, COALESCE(r.notes, ''), r.pub_date
		 FROM releases r
		 WHERE EXISTS (SELECT 1 FROM release_assets a WHERE a.release_id = r.id)
		 ORDER BY r.is_latest DESC, r.pub_date DESC, r.created_at DESC
		 LIMIT 1`,
	).Scan(&releaseID, &version, &notes, &pubDate)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get latest release: %w", err)
	}

	rows, err := s.pool.Query(ctx,
		`SELECT platform, download_url, signature, file_size
		 FROM release_assets
		 WHERE release_id = $1
		 ORDER BY platform`,
		releaseID,
	)
	if err != nil {
		return nil, fmt.Errorf("list release assets: %w", err)
	}
	defer rows.Close()

	var assets []ReleaseAsset
	for rows.Next() {
		var a ReleaseAsset
		if err := rows.Scan(&a.Platform, &a.DownloadURL, &a.Signature, &a.FileSize); err != nil {
			return nil, fmt.Errorf("scan release asset: %w", err)
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate release assets: %w", err)
	}
	if len(assets) == 0 {
		return nil, nil
	}

	return &DesktopRelease{
		Version: version,
		Notes:   notes,
		PubDate: pubDate,
		Assets:  assets,
	}, nil
}
