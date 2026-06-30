package store

import (
	"context"
	"fmt"
	"time"
)

type Game struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	AuthorName   string    `json:"author_name"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	ThumbnailURL string    `json:"thumbnail_url"`
	PlayURL      string    `json:"play_url"`
	Status       string    `json:"status"`
	PlayCount    int       `json:"play_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (s *Store) CreateGame(ctx context.Context, userID, authorName, title, description string) (*Game, error) {
	game := &Game{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO games (user_id, author_name, title, description, play_url)
		 VALUES ($1, $2, $3, $4, '')
		 RETURNING id, user_id, author_name, title, description, thumbnail_url, play_url, status, play_count, created_at, updated_at`,
		userID, authorName, title, description,
	).Scan(&game.ID, &game.UserID, &game.AuthorName, &game.Title, &game.Description,
		&game.ThumbnailURL, &game.PlayURL, &game.Status, &game.PlayCount, &game.CreatedAt, &game.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create game: %w", err)
	}
	return game, nil
}

func (s *Store) UpdateGameURLs(ctx context.Context, gameID, playURL, thumbnailURL string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE games SET play_url = $1, thumbnail_url = $2 WHERE id = $3`,
		playURL, thumbnailURL, gameID,
	)
	if err != nil {
		return fmt.Errorf("update game URLs: %w", err)
	}
	return nil
}

func (s *Store) GetGame(ctx context.Context, gameID string) (*Game, error) {
	game := &Game{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, author_name, title, description, thumbnail_url, play_url, status, play_count, created_at, updated_at
		 FROM games WHERE id = $1`,
		gameID,
	).Scan(&game.ID, &game.UserID, &game.AuthorName, &game.Title, &game.Description,
		&game.ThumbnailURL, &game.PlayURL, &game.Status, &game.PlayCount, &game.CreatedAt, &game.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get game: %w", err)
	}
	return game, nil
}

func (s *Store) ListPublishedGames(ctx context.Context) ([]Game, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, author_name, title, description, thumbnail_url, play_url, status, play_count, created_at, updated_at
		 FROM games WHERE status = 'published' ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list games: %w", err)
	}
	defer rows.Close()

	var games []Game
	for rows.Next() {
		var g Game
		if err := rows.Scan(&g.ID, &g.UserID, &g.AuthorName, &g.Title, &g.Description,
			&g.ThumbnailURL, &g.PlayURL, &g.Status, &g.PlayCount, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan game: %w", err)
		}
		games = append(games, g)
	}
	return games, nil
}

func (s *Store) DeleteGame(ctx context.Context, gameID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE games SET status = 'deleted' WHERE id = $1`,
		gameID,
	)
	if err != nil {
		return fmt.Errorf("delete game: %w", err)
	}
	return nil
}

func (s *Store) IncrementGamePlayCount(ctx context.Context, gameID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE games SET play_count = play_count + 1 WHERE id = $1`,
		gameID,
	)
	if err != nil {
		return fmt.Errorf("increment play count: %w", err)
	}
	return nil
}
