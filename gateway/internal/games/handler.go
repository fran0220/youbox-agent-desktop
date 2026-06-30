package games

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	// GamesStaticDir is the directory where game files are served by OpenResty.
	// On jingao, OpenResty maps /games-static/ to this path.
	GamesStaticDir = "/opt/1panel/apps/openresty/openresty/www/sites/jaco.jingao.club/games-static"
	MaxGameSize    = 200 << 20 // 200MB (Web games include .wasm)
)

type Handler struct {
	store *store.Store
}

func NewHandler(s *store.Store) *Handler {
	return &Handler{store: s}
}

// Deploy handles POST /api/games/deploy
// Content-Type: multipart/form-data
// Fields: file (tar.gz), title, description (optional), thumbnail (optional)
func (h *Handler) Deploy(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxGameSize)
	if err := r.ParseMultipartForm(MaxGameSize); err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file too large (max 200MB)"})
		return
	}

	title := r.FormValue("title")
	if title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
		return
	}
	description := r.FormValue("description")

	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing file field"})
		return
	}
	defer file.Close()

	// Create game record to get ID
	game, err := h.store.CreateGame(r.Context(), user.ID, user.Name, title, description)
	if err != nil {
		log.Error().Err(err).Msg("create game record")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create game"})
		return
	}

	// Extract tar.gz to static directory
	gameDir := filepath.Join(GamesStaticDir, game.ID)
	if err := os.MkdirAll(gameDir, 0755); err != nil {
		log.Error().Err(err).Str("dir", gameDir).Msg("create game directory")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	if err := extractAndValidate(file, gameDir); err != nil {
		os.RemoveAll(gameDir)
		log.Error().Err(err).Str("game_id", game.ID).Msg("extract game files")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// Handle optional thumbnail
	thumbnailURL := ""
	if thumb, _, err := r.FormFile("thumbnail"); err == nil {
		defer thumb.Close()
		thumbPath := filepath.Join(gameDir, "thumbnail.png")
		if err := saveFile(thumb, thumbPath); err != nil {
			log.Warn().Err(err).Msg("save thumbnail")
		} else {
			thumbnailURL = fmt.Sprintf("/games-static/%s/thumbnail.png", game.ID)
		}
	}

	// Update game with URLs
	playURL := fmt.Sprintf("/games-static/%s/index.html", game.ID)
	if err := h.store.UpdateGameURLs(r.Context(), game.ID, playURL, thumbnailURL); err != nil {
		log.Error().Err(err).Str("game_id", game.ID).Msg("update game URLs")
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":       game.ID,
		"play_url": playURL,
	})
}

// List handles GET /api/games (public, no auth required)
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	games, err := h.store.ListPublishedGames(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("list games")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list games"})
		return
	}
	writeJSON(w, http.StatusOK, games)
}

// Delete handles DELETE /api/games/{id} (author or admin only)
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	gameID := r.PathValue("id")
	game, err := h.store.GetGame(r.Context(), gameID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "game not found"})
		return
	}

	if game.UserID != user.ID && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	if err := h.store.DeleteGame(r.Context(), gameID); err != nil {
		log.Error().Err(err).Str("game_id", gameID).Msg("delete game")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete game"})
		return
	}

	// Clean up static files
	gameDir := filepath.Join(GamesStaticDir, gameID)
	if err := os.RemoveAll(gameDir); err != nil {
		log.Warn().Err(err).Str("dir", gameDir).Msg("cleanup game files")
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- helpers ---

// extractAndValidate extracts tar.gz and validates it contains required game files.
func extractAndValidate(r io.Reader, destDir string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("invalid gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	hasIndex := false
	hasWasm := false

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar: %w", err)
		}

		// Sanitize path to prevent directory traversal
		name := filepath.Clean(header.Name)
		if strings.Contains(name, "..") {
			continue
		}
		target := filepath.Join(destDir, name)
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(destDir)) {
			continue
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			if err := saveReader(tr, target); err != nil {
				return err
			}

			base := filepath.Base(name)
			if base == "index.html" {
				hasIndex = true
			}
			if strings.HasSuffix(base, ".wasm") {
				hasWasm = true
			}
		}
	}

	if !hasIndex {
		return fmt.Errorf("invalid game package: missing index.html")
	}
	if !hasWasm {
		return fmt.Errorf("invalid game package: missing .wasm file")
	}
	return nil
}

func saveReader(r io.Reader, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func saveFile(r io.Reader, path string) error {
	return saveReader(r, path)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
