package main

import (
	"net/http"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
)

// desktopPolicyFlags are capability toggles returned to the desktop client for pre-tool-use gating.
type desktopPolicyFlags struct {
	AllowBash         bool `json:"allow_bash"`
	AllowFileWrite    bool `json:"allow_file_write"`
	AllowMcp          bool `json:"allow_mcp"`
	AllowAPIMutations bool `json:"allow_api_mutations"`
}

func defaultDesktopPolicyFlags() desktopPolicyFlags {
	return desktopPolicyFlags{
		AllowBash:         true,
		AllowFileWrite:    true,
		AllowMcp:          true,
		AllowAPIMutations: true,
	}
}

func desktopPolicyFlagsForRole(role string) desktopPolicyFlags {
	flags := defaultDesktopPolicyFlags()
	switch role {
	case "viewer", "readonly", "read_only":
		flags.AllowBash = false
		flags.AllowFileWrite = false
		flags.AllowMcp = false
		flags.AllowAPIMutations = false
	}
	return flags
}

// buildDesktopPolicyResponse returns role/trust/policy data for GET /api/desktop/policy.
func buildDesktopPolicyResponse(role string) map[string]interface{} {
	flags := desktopPolicyFlagsForRole(role)
	return map[string]interface{}{
		"role": role,
		"flags": map[string]bool{
			"allow_bash":          flags.AllowBash,
			"allow_file_write":    flags.AllowFileWrite,
			"allow_mcp":           flags.AllowMcp,
			"allow_api_mutations": flags.AllowAPIMutations,
		},
		"workspace_trust_default":           true,
		"require_high_risk_confirmation":    true,
		"require_admin_escalation_approval": true,
	}
}

func desktopPolicyHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, buildDesktopPolicyResponse(user.Role))
	}
}
