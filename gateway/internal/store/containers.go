package store

import (
	"context"
	"fmt"
	"time"
)

const (
	// ContainerTypePiVM is the DB-stored container_type value.
	// The literal "openclaw" is kept for backward compatibility with existing rows.
	ContainerTypePiVM = "openclaw"
)

type ContainerInfo struct {
	UserID         string
	ContainerName  string
	ContainerIP    string
	ContainerToken string
	HostPort       int
	VncPort        int    // noVNC websockify port on host
	ContainerType  string // active value: "openclaw"
	Status         string // "creating" | "running" | "paused" | "stopped" | "exited"
}

type Container struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ContainerName  string    `json:"container_name"`
	ContainerIP    string    `json:"container_ip"`
	ContainerToken string    `json:"-"`
	Status         string    `json:"status"`
	CPULimit       int       `json:"cpu_limit"`
	MemoryMB       int       `json:"memory_mb"`
	DiskMB         int       `json:"disk_mb"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (s *Store) GetContainerInfo(ctx context.Context, userID, containerType string) (*ContainerInfo, error) {
	info := &ContainerInfo{}
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, container_name, COALESCE(host(container_ip), ''), container_token, COALESCE(host_port, 0), COALESCE(vnc_port, 0), COALESCE(container_type, 'openclaw'), COALESCE(status, 'creating')
		 FROM containers WHERE user_id = $1 AND container_type = $2`,
		userID, containerType,
	).Scan(&info.UserID, &info.ContainerName, &info.ContainerIP, &info.ContainerToken, &info.HostPort, &info.VncPort, &info.ContainerType, &info.Status)
	if err != nil {
		return nil, fmt.Errorf("get container info: %w", err)
	}
	return info, nil
}

func (s *Store) CreateContainer(ctx context.Context, userID, containerName, containerToken string, hostPort, vncPort int, containerType string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO containers (user_id, container_name, container_token, host_port, vnc_port, container_type, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'creating')
		 ON CONFLICT (user_id, container_type) DO UPDATE SET container_name = $2, container_token = $3, host_port = $4, vnc_port = $5, container_ip = NULL, status = 'creating'`,
		userID, containerName, containerToken, hostPort, vncPort, containerType,
	)
	return err
}

func (s *Store) UpdateContainerIP(ctx context.Context, userID, containerType, ip string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE containers SET container_ip = $1::inet, status = 'running' WHERE user_id = $2 AND container_type = $3`,
		ip, userID, containerType,
	)
	return err
}

func (s *Store) UpdateContainer(ctx context.Context, userID, containerType, name, ip, token string, hostPort, vncPort int) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE containers SET container_name = $1, container_ip = $2::inet, container_token = $3, host_port = $4, vnc_port = $5, status = 'running'
		 WHERE user_id = $6 AND container_type = $7`,
		name, ip, token, hostPort, vncPort, userID, containerType,
	)
	return err
}

func (s *Store) UpdateContainerStatusByName(ctx context.Context, containerName, status string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE containers SET status = $1 WHERE container_name = $2`,
		status, containerName,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("container not found: %s", containerName)
	}
	return nil
}

// ListContainersByType returns all containers of a given type.
func (s *Store) ListContainersByType(ctx context.Context, containerType string) ([]*ContainerInfo, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT user_id, container_name, COALESCE(host(container_ip), ''), container_token, COALESCE(host_port, 0), COALESCE(vnc_port, 0), COALESCE(container_type, 'openclaw'), COALESCE(status, 'creating')
		 FROM containers WHERE container_type = $1`,
		containerType,
	)
	if err != nil {
		return nil, fmt.Errorf("list containers by type: %w", err)
	}
	defer rows.Close()

	var results []*ContainerInfo
	for rows.Next() {
		info := &ContainerInfo{}
		if err := rows.Scan(&info.UserID, &info.ContainerName, &info.ContainerIP, &info.ContainerToken, &info.HostPort, &info.VncPort, &info.ContainerType, &info.Status); err != nil {
			return nil, fmt.Errorf("scan container: %w", err)
		}
		results = append(results, info)
	}
	return results, rows.Err()
}

// GetUserIDByContainerName looks up the user who owns a container (for freeze-time memory pull).
func (s *Store) GetUserIDByContainerName(ctx context.Context, containerName string) (string, error) {
	var userID string
	err := s.pool.QueryRow(ctx,
		`SELECT user_id FROM containers WHERE container_name = $1`, containerName).Scan(&userID)
	return userID, err
}

// GetContainerInfoByName looks up full container info by container_name.
func (s *Store) GetContainerInfoByName(ctx context.Context, containerName string) (*ContainerInfo, error) {
	info := &ContainerInfo{}
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, container_name, COALESCE(host(container_ip), ''), container_token, COALESCE(host_port, 0), COALESCE(vnc_port, 0), COALESCE(container_type, 'openclaw'), COALESCE(status, 'creating')
		 FROM containers WHERE container_name = $1`,
		containerName,
	).Scan(&info.UserID, &info.ContainerName, &info.ContainerIP, &info.ContainerToken, &info.HostPort, &info.VncPort, &info.ContainerType, &info.Status)
	if err != nil {
		return nil, fmt.Errorf("get container info by name: %w", err)
	}
	return info, nil
}

// GetUserByContainerToken looks up the user who owns a container by its token.
// Used for container-initiated API calls (for example: game deploy from container runtime).
func (s *Store) GetUserByContainerToken(ctx context.Context, token string) (*User, error) {
	user := &User{}
	err := s.pool.QueryRow(ctx,
		`SELECT u.id, u.name, u.email, u.role, u.feishu_open_id, u.created_at, u.updated_at
		 FROM users u JOIN containers c ON u.id = c.user_id
		 WHERE c.container_token = $1 AND c.status IN ('running', 'paused')`,
		token,
	).Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.FeishuOpenID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by container token: %w", err)
	}
	return user, nil
}
