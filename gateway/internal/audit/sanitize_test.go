package audit

import (
	"strings"
	"testing"
)

func TestSanitizeResourceID_RedactsSkKey(t *testing.T) {
	t.Parallel()
	in := "run with sk-abc1234567890xyz end"
	out := SanitizeResourceID(in)
	if strings.Contains(out, "sk-abc") {
		t.Fatalf("sk key leaked: %q", out)
	}
	if !strings.Contains(out, "[REDACTED]") {
		t.Fatalf("expected [REDACTED], got %q", out)
	}
}

func TestMaskAssignmentSecrets_MasksAPIKey(t *testing.T) {
	t.Parallel()
	in := "export API_KEY=sk-supersecretkey1234567890"
	out := MaskAssignmentSecrets(in)
	if strings.Contains(out, "sk-super") {
		t.Fatalf("secret leaked: %q", out)
	}
	if !strings.Contains(out, "API_KEY=") {
		t.Fatalf("key prefix missing: %q", out)
	}
}

func TestSanitizeResourceID_TruncatesLongInput(t *testing.T) {
	t.Parallel()
	in := strings.Repeat("a", 3000)
	out := SanitizeResourceID(in)
	if len(out) != maxSanitizedResourceIDLen {
		t.Fatalf("len %d want %d", len(out), maxSanitizedResourceIDLen)
	}
}
