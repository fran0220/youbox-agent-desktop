package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

type InviteCode struct {
	Code      string     `json:"code"`
	Role      string     `json:"role"`
	MaxUses   int        `json:"max_uses"`
	UsedCount int        `json:"used_count"`
	CreatedBy string     `json:"created_by"`
	Note      string     `json:"note"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}

func (s *Store) CreateInviteCode(ctx context.Context, role, createdBy, note string, maxUses int, expiresAt *time.Time) (*InviteCode, error) {
	code, err := generateCode(16)
	if err != nil {
		return nil, fmt.Errorf("generate code: %w", err)
	}

	invite := &InviteCode{}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO invite_codes (code, role, max_uses, created_by, note, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING code, role, max_uses, used_count, created_by, note, expires_at, created_at`,
		code, role, maxUses, createdBy, note, expiresAt,
	).Scan(&invite.Code, &invite.Role, &invite.MaxUses, &invite.UsedCount, &invite.CreatedBy, &invite.Note, &invite.ExpiresAt, &invite.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create invite code: %w", err)
	}
	return invite, nil
}

func (s *Store) ListInviteCodes(ctx context.Context) ([]InviteCode, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT code, role, max_uses, used_count, created_by, note, expires_at, created_at
		 FROM invite_codes ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list invite codes: %w", err)
	}
	defer rows.Close()

	var codes []InviteCode
	for rows.Next() {
		var c InviteCode
		if err := rows.Scan(&c.Code, &c.Role, &c.MaxUses, &c.UsedCount, &c.CreatedBy, &c.Note, &c.ExpiresAt, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan invite code: %w", err)
		}
		codes = append(codes, c)
	}
	return codes, nil
}

func generateCode(length int) (string, error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
