package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/github"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

type feedbackPersistence interface {
	InsertFeedback(ctx context.Context, name, email, category, message, appVersion string) error
}

type storeFeedbackPersistence struct {
	s *store.Store
}

func (p *storeFeedbackPersistence) InsertFeedback(ctx context.Context, name, email, category, message, appVersion string) error {
	return p.s.InsertFeedback(ctx, name, email, category, message, appVersion)
}

func feedbackHandler(p feedbackPersistence, gh *github.Client) http.HandlerFunc {
	type feedbackRequest struct {
		Category    string   `json:"category"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Images      []string `json:"images"`
		Version     string   `json:"version"`
	}

	categoryLabels := map[string]string{
		"bug":      "bug",
		"feature":  "enhancement",
		"question": "question",
		"other":    "feedback",
	}

	// DB feedback.category CHECK allows bug/feature/general.
	categoryDB := map[string]string{
		"bug":      "bug",
		"feature":  "feature",
		"question": "general",
		"other":    "general",
	}

	titlePrefix := map[string]string{
		"bug":      "[Bug]",
		"feature":  "[Feature]",
		"question": "[Question]",
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req feedbackRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		req.Category = strings.ToLower(strings.TrimSpace(req.Category))
		req.Title = strings.TrimSpace(req.Title)
		req.Description = strings.TrimSpace(req.Description)
		req.Version = strings.TrimSpace(req.Version)

		if req.Title == "" || req.Description == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title and description required"})
			return
		}

		if len(req.Images) > 3 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "max 3 images"})
			return
		}

		label, ok := categoryLabels[req.Category]
		if !ok {
			label = "feedback"
		}
		dbCat, ok := categoryDB[req.Category]
		if !ok {
			dbCat = "general"
		}

		imageURLs := make([]string, 0, len(req.Images))
		if gh != nil && gh.Configured() {
			for i, img := range req.Images {
				img = strings.TrimSpace(img)
				if img == "" {
					continue
				}

				if idx := strings.Index(img, ","); idx > 0 && strings.Contains(img[:idx], "base64") {
					img = img[idx+1:]
				}

				data, err := base64.StdEncoding.DecodeString(img)
				if err != nil {
					log.Warn().Err(err).Int("index", i).Msg("feedback: invalid base64 image, skipping")
					continue
				}

				now := time.Now()
				path := fmt.Sprintf("%s-%02d.jpg", now.Format("2006/01/02-150405"), i)
				rawURL, err := gh.UploadImage(path, data)
				if err != nil {
					log.Error().Err(err).Int("index", i).Msg("feedback: upload image failed")
					continue
				}
				imageURLs = append(imageURLs, rawURL)
			}
		}

		var body strings.Builder
		body.WriteString(req.Description)
		body.WriteString("\n\n")
		for _, imageURL := range imageURLs {
			body.WriteString(fmt.Sprintf("![screenshot](%s)\n\n", imageURL))
		}
		body.WriteString("---\n")
		body.WriteString(fmt.Sprintf("> 提交者: %s | 版本: %s | 时间: %s\n",
			user.Name,
			req.Version,
			time.Now().Format("2006-01-02 15:04"),
		))

		issueNumber := 0
		issueURL := ""
		if gh != nil && gh.Configured() {
			prefix := titlePrefix[req.Category]
			if prefix == "" {
				prefix = "[Feedback]"
			}

			var err error
			issueNumber, issueURL, err = gh.CreateIssue(
				fmt.Sprintf("%s %s", prefix, req.Title),
				body.String(),
				[]string{label},
			)
			if err != nil {
				log.Error().Err(err).Msg("feedback: create github issue failed")
			}
		}

		storedMessage := req.Title + "\n\n" + req.Description
		if err := p.InsertFeedback(r.Context(), user.Name, user.Email, dbCat, storedMessage, req.Version); err != nil {
			log.Error().Err(err).Msg("feedback: save to db failed")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save feedback"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":       "ok",
			"issue_number": issueNumber,
			"issue_url":    issueURL,
		})
	}
}

func desktopFeedbackHandler(s *store.Store, gh *github.Client) http.HandlerFunc {
	return feedbackHandler(&storeFeedbackPersistence{s: s}, gh)
}
