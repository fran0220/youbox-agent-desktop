package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
)

const maxAuditResourceIDLen = 2048

type desktopAuditRequest struct {
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
}

type desktopAuditRecorder interface {
	Log(userID, action, resourceType, resourceID, ip string)
}

func desktopAuditHandler(al desktopAuditRecorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var body desktopAuditRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		action := strings.TrimSpace(body.Action)
		if action == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "action required"})
			return
		}

		resourceType := strings.TrimSpace(body.ResourceType)
		if resourceType == "" {
			resourceType = "tool"
		}

		resourceID := strings.TrimSpace(body.ResourceID)
		resourceID = audit.SanitizeResourceID(resourceID)
		resourceID = audit.MaskAssignmentSecrets(resourceID)
		if len(resourceID) > maxAuditResourceIDLen {
			resourceID = resourceID[:maxAuditResourceIDLen]
		}

		al.Log(user.ID, action, resourceType, resourceID, r.RemoteAddr)
		w.WriteHeader(http.StatusNoContent)
	}
}
