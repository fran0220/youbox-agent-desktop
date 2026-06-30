package audit

import (
	"context"
	"net"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type Logger struct {
	pool *pgxpool.Pool
}

func NewLogger(pool *pgxpool.Pool) *Logger {
	return &Logger{pool: pool}
}

func (l *Logger) Log(userID, action, resourceType, resourceID, ip string) {
	// Strip port from ip:port format (r.RemoteAddr includes port)
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	_, err := l.pool.Exec(context.Background(),
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address)
		 VALUES ($1, $2, $3, $4, $5::inet)`,
		userID, action, resourceType, resourceID, ip,
	)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Str("action", action).Msg("audit log write failed")
	}
}
