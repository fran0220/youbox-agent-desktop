package store

import (
	"context"
	"fmt"
	"time"
)

type CronJob struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	Name             *string    `json:"name,omitempty"`
	ScheduleKind     string     `json:"schedule_kind"`
	ScheduleExpr     string     `json:"schedule_expr"`
	Prompt           string     `json:"prompt"`
	SessionTarget    string     `json:"session_target"`
	Enabled          bool       `json:"enabled"`
	DeleteAfterRun   bool       `json:"delete_after_run"`
	DeliveryMode     *string    `json:"delivery_mode,omitempty"`
	LastRun          *time.Time `json:"last_run,omitempty"`
	RunCount         int        `json:"run_count"`
	ConsecutiveErrors int       `json:"consecutive_errors"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func (s *Store) ListCronJobs(ctx context.Context, userID string) ([]CronJob, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, name, schedule_kind, schedule_expr, prompt,
		        session_target, enabled, delete_after_run, delivery_mode,
		        last_run, run_count, consecutive_errors, created_at, updated_at
		 FROM cron_jobs WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list cron jobs: %w", err)
	}
	defer rows.Close()

	var jobs []CronJob
	for rows.Next() {
		var j CronJob
		if err := rows.Scan(
			&j.ID, &j.UserID, &j.Name, &j.ScheduleKind, &j.ScheduleExpr, &j.Prompt,
			&j.SessionTarget, &j.Enabled, &j.DeleteAfterRun, &j.DeliveryMode,
			&j.LastRun, &j.RunCount, &j.ConsecutiveErrors, &j.CreatedAt, &j.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan cron job: %w", err)
		}
		jobs = append(jobs, j)
	}
	return jobs, nil
}

func (s *Store) CreateCronJob(ctx context.Context, userID, scheduleKind, scheduleExpr, prompt string, name *string, sessionTarget string, deleteAfterRun bool, deliveryMode *string) (*CronJob, error) {
	if sessionTarget == "" {
		sessionTarget = "isolated"
	}
	j := &CronJob{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO cron_jobs (user_id, name, schedule_kind, schedule_expr, prompt, session_target, delete_after_run, delivery_mode)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, user_id, name, schedule_kind, schedule_expr, prompt,
		           session_target, enabled, delete_after_run, delivery_mode,
		           last_run, run_count, consecutive_errors, created_at, updated_at`,
		userID, name, scheduleKind, scheduleExpr, prompt, sessionTarget, deleteAfterRun, deliveryMode,
	).Scan(
		&j.ID, &j.UserID, &j.Name, &j.ScheduleKind, &j.ScheduleExpr, &j.Prompt,
		&j.SessionTarget, &j.Enabled, &j.DeleteAfterRun, &j.DeliveryMode,
		&j.LastRun, &j.RunCount, &j.ConsecutiveErrors, &j.CreatedAt, &j.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create cron job: %w", err)
	}
	return j, nil
}

func (s *Store) DeleteCronJob(ctx context.Context, userID, jobID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM cron_jobs WHERE id = $1 AND user_id = $2`,
		jobID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete cron job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("cron job not found")
	}
	return nil
}

func (s *Store) GetCronJob(ctx context.Context, userID, jobID string) (*CronJob, error) {
	j := &CronJob{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, name, schedule_kind, schedule_expr, prompt,
		        session_target, enabled, delete_after_run, delivery_mode,
		        last_run, run_count, consecutive_errors, created_at, updated_at
		 FROM cron_jobs WHERE id = $1 AND user_id = $2`,
		jobID, userID,
	).Scan(
		&j.ID, &j.UserID, &j.Name, &j.ScheduleKind, &j.ScheduleExpr, &j.Prompt,
		&j.SessionTarget, &j.Enabled, &j.DeleteAfterRun, &j.DeliveryMode,
		&j.LastRun, &j.RunCount, &j.ConsecutiveErrors, &j.CreatedAt, &j.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get cron job: %w", err)
	}
	return j, nil
}
