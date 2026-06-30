package store

import "context"

type SystemSetting struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Description string `json:"description"`
}

func (s *Store) GetAllSettings(ctx context.Context) ([]SystemSetting, error) {
	rows, err := s.pool.Query(ctx,
		"SELECT key, value, description FROM system_settings ORDER BY key")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var settings []SystemSetting
	for rows.Next() {
		var setting SystemSetting
		if err := rows.Scan(&setting.Key, &setting.Value, &setting.Description); err != nil {
			return nil, err
		}
		settings = append(settings, setting)
	}
	return settings, nil
}

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.pool.QueryRow(ctx,
		"SELECT value FROM system_settings WHERE key = $1", key).Scan(&value)
	return value, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO system_settings (key, value) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET value = $2`,
		key, value)
	return err
}
