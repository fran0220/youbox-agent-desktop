package main

import (
	"os"
	"strings"
)

// desktopWorkspaceTrustConfig holds gateway-side workspace trust defaults and overrides.
type desktopWorkspaceTrustConfig struct {
	TrustDefault bool
	// Slugs listed here are always untrusted (blocks write/bash regardless of local permission mode).
	UntrustedSlugs map[string]struct{}
}

func loadDesktopWorkspaceTrustConfig() desktopWorkspaceTrustConfig {
	cfg := desktopWorkspaceTrustConfig{
		TrustDefault:   true,
		UntrustedSlugs: map[string]struct{}{},
	}

	if v := strings.TrimSpace(os.Getenv("GATEWAY_DESKTOP_WORKSPACE_TRUST_DEFAULT")); v != "" {
		switch strings.ToLower(v) {
		case "0", "false", "no", "off":
			cfg.TrustDefault = false
		case "1", "true", "yes", "on":
			cfg.TrustDefault = true
		}
	}

	if raw := strings.TrimSpace(os.Getenv("GATEWAY_DESKTOP_UNTRUSTED_WORKSPACE_SLUGS")); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			slug := strings.TrimSpace(part)
			if slug != "" {
				cfg.UntrustedSlugs[slug] = struct{}{}
			}
		}
	}

	return cfg
}

func resolveWorkspaceTrusted(cfg desktopWorkspaceTrustConfig, workspaceSlug string) bool {
	slug := strings.TrimSpace(workspaceSlug)
	if slug != "" {
		if _, untrusted := cfg.UntrustedSlugs[slug]; untrusted {
			return false
		}
	}
	return cfg.TrustDefault
}
