package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_ParsesYAMLAndAppliesDefaults(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, `
database:
  url: postgresql://user:pass@localhost:5432/jacoworks
`)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Database.URL != "postgresql://user:pass@localhost:5432/jacoworks" {
		t.Fatalf("database url = %q", cfg.Database.URL)
	}
	if cfg.Server.Port != 8080 {
		t.Fatalf("server port = %d, want %d", cfg.Server.Port, 8080)
	}
	if cfg.Server.Host != "0.0.0.0" {
		t.Fatalf("server host = %q, want %q", cfg.Server.Host, "0.0.0.0")
	}
	if cfg.Auth.SessionTTLHours != 720 {
		t.Fatalf("session ttl hours = %d, want %d", cfg.Auth.SessionTTLHours, 720)
	}
	if cfg.PiVM.Port != 18789 {
		t.Fatalf("pi vm port = %d, want %d", cfg.PiVM.Port, 18789)
	}
	if cfg.PiVM.Image != "pi-ready" {
		t.Fatalf("pi vm image = %q, want %q", cfg.PiVM.Image, "pi-ready")
	}
	if cfg.PiVM.DataRoot != "/srv/jacoworks/openclaw" {
		t.Fatalf("pi vm data root = %q, want %q", cfg.PiVM.DataRoot, "/srv/jacoworks/openclaw")
	}
}

func TestLoad_InvalidYAMLReturnsError(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, "server: [")
	_, err := Load(path)
	if err == nil {
		t.Fatalf("expected parse error")
	}
	if !strings.Contains(err.Error(), "parse config") {
		t.Fatalf("error = %v, want parse config error", err)
	}
}

func TestLoad_MissingRequiredDatabaseURLReturnsError(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, "server:\n  port: 8847\n")
	_, err := Load(path)
	if err == nil {
		t.Fatalf("expected required field error")
	}
	if !strings.Contains(err.Error(), "database.url is required") {
		t.Fatalf("error = %v, want missing database.url error", err)
	}
}

func TestLoad_EnvOverrides(t *testing.T) {
	path := writeConfigFile(t, `
server:
  host: 0.0.0.0
  port: 8080
database:
  url: postgresql://yaml-value
openclaw:
  host_ip: 10.0.0.10
llm:
  proxy_url: http://yaml-proxy
`)

	t.Setenv("GATEWAY_SERVER_HOST", "127.0.0.1")
	t.Setenv("GATEWAY_SERVER_PORT", "9999")
	t.Setenv("GATEWAY_SERVER_STATIC_DIR", "/tmp/jacoworks-static")
	t.Setenv("GATEWAY_DATABASE_URL", "postgresql://env-value")
	t.Setenv("GATEWAY_LLM_PROXY_URL", "http://env-proxy")
	t.Setenv("GATEWAY_LLM_GROK_API_URL", "http://grok.local/v1")
	t.Setenv("GATEWAY_LLM_GROK_API_KEY", "grok-secret")
	t.Setenv("GATEWAY_LLM_ASSET_GATEWAY_TOKEN", "asset-token")
	t.Setenv("GATEWAY_PIVM_IMAGE", "pi-ready-custom")
	t.Setenv("GATEWAY_PIVM_PORT", "19000")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.Host != "127.0.0.1" {
		t.Fatalf("server host = %q, want %q", cfg.Server.Host, "127.0.0.1")
	}
	if cfg.Server.Port != 9999 {
		t.Fatalf("server port = %d, want %d", cfg.Server.Port, 9999)
	}
	if cfg.Server.StaticDir != "/tmp/jacoworks-static" {
		t.Fatalf("server static dir = %q, want %q", cfg.Server.StaticDir, "/tmp/jacoworks-static")
	}
	if cfg.Database.URL != "postgresql://env-value" {
		t.Fatalf("database url = %q, want %q", cfg.Database.URL, "postgresql://env-value")
	}
	if cfg.LLM.ProxyURL != "http://env-proxy" {
		t.Fatalf("llm proxy url = %q, want %q", cfg.LLM.ProxyURL, "http://env-proxy")
	}
	if cfg.LLM.GrokAPIURL != "http://grok.local/v1" {
		t.Fatalf("llm grok api url = %q, want %q", cfg.LLM.GrokAPIURL, "http://grok.local/v1")
	}
	if cfg.LLM.GrokAPIKey != "grok-secret" {
		t.Fatalf("llm grok api key = %q, want %q", cfg.LLM.GrokAPIKey, "grok-secret")
	}
	if cfg.LLM.AssetGatewayToken != "asset-token" {
		t.Fatalf("llm asset gateway token = %q, want %q", cfg.LLM.AssetGatewayToken, "asset-token")
	}
	if cfg.PiVM.HostIP != "10.0.0.10" {
		t.Fatalf("pi vm host ip = %q, want %q", cfg.PiVM.HostIP, "10.0.0.10")
	}
	if cfg.PiVM.Image != "pi-ready-custom" {
		t.Fatalf("pi vm image = %q, want %q", cfg.PiVM.Image, "pi-ready-custom")
	}
	if cfg.PiVM.Port != 19000 {
		t.Fatalf("pi vm port = %d, want %d", cfg.PiVM.Port, 19000)
	}
}

func TestLoad_OpenClawYAMLKeyStillPopulatesPiVM(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, `
database:
  url: postgresql://user:pass@localhost:5432/jacoworks
openclaw:
  image: pi-ready-staging
  host_ip: 192.168.31.10
  base_port: 19900
`)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.PiVM.Image != "pi-ready-staging" {
		t.Fatalf("pi vm image = %q, want %q", cfg.PiVM.Image, "pi-ready-staging")
	}
	if cfg.PiVM.HostIP != "192.168.31.10" {
		t.Fatalf("pi vm host ip = %q, want %q", cfg.PiVM.HostIP, "192.168.31.10")
	}
	if cfg.PiVM.BasePort != 19900 {
		t.Fatalf("pi vm base port = %d, want %d", cfg.PiVM.BasePort, 19900)
	}
}

func TestAddr(t *testing.T) {
	t.Parallel()

	cfg := &Config{Server: ServerConfig{Host: "127.0.0.1", Port: 8847}}
	if got := cfg.Addr(); got != "127.0.0.1:8847" {
		t.Fatalf("Addr() = %q, want %q", got, "127.0.0.1:8847")
	}
}

func TestGetLLMAndUpdateLLM(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	want := LLMConfig{ProxyURL: "http://proxy", ProxyKey: "secret", OpenAIAPIKey: "openai-key"}
	cfg.UpdateLLM(want)

	got := cfg.GetLLM()
	if got != want {
		t.Fatalf("GetLLM() = %+v, want %+v", got, want)
	}

	got.ProxyURL = "changed"
	if cfg.GetLLM().ProxyURL != want.ProxyURL {
		t.Fatalf("GetLLM() should return a value copy")
	}
}

func writeConfigFile(t *testing.T, content string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "gateway.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	return path
}
