package audit

import (
	"regexp"
	"strings"
)

var (
	reSkKey      = regexp.MustCompile(`\b(sk-[A-Za-z0-9_-]{8,})\b`)
	reBearer     = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._-]{20,}\b`)
	reAPIKeyPair = regexp.MustCompile(`(?i)\b(api[_-]?key\s*[=:]\s*)([^\s'"]+)`)
	rePassword   = regexp.MustCompile(`(?i)\b(password\s*[=:]\s*)([^\s'"]+)`)
	reTokenHex   = regexp.MustCompile(`(?i)\b(token\s*[=:]\s*)([0-9a-f]{32,})`)
)

const maxSanitizedResourceIDLen = 2048

// SanitizeResourceID redacts common secret patterns before persisting audit rows.
func SanitizeResourceID(value string) string {
	out := value
	out = reSkKey.ReplaceAllString(out, "[REDACTED]")
	out = reBearer.ReplaceAllString(out, "Bearer [REDACTED]")
	out = reAPIKeyPair.ReplaceAllString(out, `${1}[REDACTED]`)
	out = rePassword.ReplaceAllString(out, `${1}[REDACTED]`)
	out = reTokenHex.ReplaceAllString(out, `${1}[REDACTED]`)
	if len(out) > maxSanitizedResourceIDLen {
		out = out[:maxSanitizedResourceIDLen]
	}
	return out
}

// MaskAssignmentSecrets masks the value after = or : in KEY=VALUE style env assignments
// (defense in depth when persisting command lines that may contain secrets).
func MaskAssignmentSecrets(value string) string {
	if !strings.Contains(value, "=") && !strings.Contains(value, ":") {
		return value
	}
	parts := strings.Fields(value)
	for i, part := range parts {
		for _, sep := range []string{"=", ":"} {
			idx := strings.Index(part, sep)
			if idx <= 0 || idx >= len(part)-1 {
				continue
			}
			key := part[:idx]
			if isLikelySecretKey(key) {
				parts[i] = key + sep + strings.Repeat("*", 8)
			}
		}
	}
	return strings.Join(parts, " ")
}

func isLikelySecretKey(key string) bool {
	u := strings.ToUpper(key)
	secretHints := []string{"KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "AUTH"}
	for _, hint := range secretHints {
		if strings.Contains(u, hint) {
			return true
		}
	}
	return false
}
