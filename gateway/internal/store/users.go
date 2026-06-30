package store

import (
	"context"
	"fmt"
	"time"
)

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	FeishuOpenID *string   `json:"feishu_open_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (s *Store) CreateUser(ctx context.Context, name, email, passwordHash, role string) (*User, error) {
	if role == "" {
		role = "user"
	}
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (name, email, password_hash, role)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, email, password_hash, role, feishu_open_id, created_at, updated_at`,
		name, email, passwordHash, role,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	return user, nil
}

func (s *Store) GetUserByID(ctx context.Context, id string) (*User, error) {
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, email, password_hash, role, feishu_open_id, created_at, updated_at
		 FROM users WHERE id = $1`,
		id,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return user, nil
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, email, password_hash, role, feishu_open_id, created_at, updated_at
		 FROM users WHERE email = $1`,
		email,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return user, nil
}

func (s *Store) GetUserByName(ctx context.Context, name string) (*User, error) {
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, email, password_hash, role, feishu_open_id, created_at, updated_at
		 FROM users WHERE name = $1`,
		name,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by name: %w", err)
	}
	return user, nil
}

func (s *Store) GetUserByFeishuID(ctx context.Context, feishuOpenID string) (*User, error) {
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, email, password_hash, role, feishu_open_id, created_at, updated_at
		 FROM users WHERE feishu_open_id = $1`,
		feishuOpenID,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by feishu id: %w", err)
	}
	return user, nil
}

func (s *Store) FindOrCreateFeishuUser(ctx context.Context, feishuOpenID, name, email string) (*User, error) {
	// Try to find existing user by feishu_open_id
	user, err := s.GetUserByFeishuID(ctx, feishuOpenID)
	if err == nil {
		return user, nil
	}

	// Try to find by email and link feishu_open_id
	user, err = s.GetUserByEmail(ctx, email)
	if err == nil {
		_, err = s.pool.Exec(ctx,
			`UPDATE users SET feishu_open_id = $1, name = $2 WHERE id = $3`,
			feishuOpenID, name, user.ID,
		)
		if err == nil {
			user.FeishuOpenID = &feishuOpenID
			user.Name = name
		}
		return user, nil
	}

	// Create new user with feishu_open_id (no password, SSO only)
	user = &User{}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO users (name, email, password_hash, role, feishu_open_id)
		 VALUES ($1, $2, '', 'user', $3)
		 RETURNING id, name, email, password_hash, role, feishu_open_id, created_at, updated_at`,
		name, email, feishuOpenID,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create feishu user: %w", err)
	}
	return user, nil
}

// --- Auth Sessions ---

func (s *Store) CreateAuthSession(ctx context.Context, token, userID string, ttl time.Duration, ip, userAgent string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO auth_sessions (token, user_id, expires_at, ip_address, user_agent)
		 VALUES ($1, $2, $3, $4, $5)`,
		token, userID, time.Now().Add(ttl), ip, userAgent,
	)
	return err
}

func (s *Store) ValidateAuthSession(ctx context.Context, token string) (*User, error) {
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT u.id, u.name, u.email, u.role
		 FROM auth_sessions s JOIN users u ON s.user_id = u.id
		 WHERE s.token = $1 AND s.expires_at > now()`,
		token,
	).Scan(&user.ID, &user.Name, &user.Email, &user.Role)
	if err != nil {
		return nil, fmt.Errorf("validate session: %w", err)
	}
	return user, nil
}

func (s *Store) DeleteAuthSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM auth_sessions WHERE token = $1`, token)
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM auth_sessions WHERE user_id = $1`, userID)
	return err
}

// ValidateInviteCode checks if an invite code is valid (not expired, not fully used).
func (s *Store) ValidateInviteCode(ctx context.Context, code string) (*InviteCode, error) {
	invite := &InviteCode{}
	err := s.pool.QueryRow(ctx,
		`SELECT code, role, max_uses, used_count, created_by, note, expires_at, created_at
		 FROM invite_codes
		 WHERE code = $1
		   AND used_count < max_uses
		   AND (expires_at IS NULL OR expires_at > now())`,
		code,
	).Scan(&invite.Code, &invite.Role, &invite.MaxUses, &invite.UsedCount, &invite.CreatedBy, &invite.Note, &invite.ExpiresAt, &invite.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("validate invite code: %w", err)
	}
	return invite, nil
}

func (s *Store) UseInviteCode(ctx context.Context, code, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `UPDATE invite_codes SET used_count = used_count + 1 WHERE code = $1`, code)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO invite_code_usages (code, user_id) VALUES ($1, $2)`, code, userID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
