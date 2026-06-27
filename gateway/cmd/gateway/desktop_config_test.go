package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type stubModelsLister struct {
	providers []store.LLMProvider
	models    []store.LLMModel
}

func (s *stubModelsLister) ListProviders(ctx context.Context) ([]store.LLMProvider, error) {
	return s.providers, nil
}

func (s *stubModelsLister) ListModels(ctx context.Context) ([]store.LLMModel, error) {
	return s.models, nil
}

func testLLMConfig() config.LLMConfig {
	return config.LLMConfig{
		ProxyURL:           "https://api.xiaomao.chat",
		ProxyKey:           "proxy-key-secret",
		OpenAIAPIKey:       "openai-secret",
		ExaAPIKey:          "exa-secret",
		TavilyKey:          "tavily-secret",
		EmbeddingBaseURL:   "https://embed.example/v1",
		EmbeddingAPIKey:    "embed-secret",
		FalAPIKey:          "fal-secret",
		MineruToken:        "mineru-secret",
		JimengAPIURL:       "https://jimeng.example",
		JimengAPIKey:       "jimeng-secret",
		AssetGatewayToken:  "asset-token-secret",
		AssetGatewayURL:    "https://asset.example",
		AISearchGatewayURL: "https://aisearch.example",
		AISearchToken:      "aisearch-secret",
		PrimaryModel:       "gpt-5.5",
		PrimaryProvider:    "proxy-gpt",
	}
}

func TestBuildDesktopConfigResponse_RedactsNonLlmSecrets(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{}
	cfg.UpdateLLM(testLLMConfig())
	cfg.SetCliToolsManifest(`{"tools":[]}`)

	list := &stubModelsLister{
		providers: []store.LLMProvider{{Key: "proxy-gpt", APIType: "openai", Enabled: true}},
		models: []store.LLMModel{{
			ModelID: "gpt-5.5", ProviderKey: "proxy-gpt", DisplayName: "GPT 5.5",
			ContextWindow: 128000, MaxTokens: 8192, Reasoning: true, Enabled: true,
		}},
	}

	body := buildDesktopConfigResponse(context.Background(), cfg, list)
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(raw)

	for _, key := range desktopConfigRedactedKeys {
		if strings.Contains(s, `"`+key+`"`) {
			t.Fatalf("redacted key %q present in desktop config JSON", key)
		}
	}

	secrets := []string{
		"openai-secret", "exa-secret", "tavily-secret", "fal-secret", "mineru-secret",
		"jimeng-secret", "asset-token-secret", "aisearch-secret",
	}
	for _, secret := range secrets {
		if strings.Contains(s, secret) {
			t.Fatalf("non-LLM secret value %q leaked in desktop config payload", secret)
		}
	}

	if body["llm_proxy_key"] != "proxy-key-secret" {
		t.Fatalf("llm_proxy_key = %v, want retained", body["llm_proxy_key"])
	}
	if body["embedding_api_key"] != "embed-secret" {
		t.Fatalf("embedding_api_key = %v, want retained", body["embedding_api_key"])
	}
}

func TestBuildDesktopConfigResponse_ReturnsLlmFields(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{}
	cfg.UpdateLLM(testLLMConfig())

	list := &stubModelsLister{
		providers: []store.LLMProvider{{Key: "proxy-gpt", APIType: "openai", Enabled: true}},
		models: []store.LLMModel{{
			ModelID: "gpt-5.5", ProviderKey: "proxy-gpt", DisplayName: "GPT 5.5",
			ContextWindow: 200000, MaxTokens: 16384, Reasoning: false, Enabled: true,
		}},
	}

	body := buildDesktopConfigResponse(context.Background(), cfg, list)

	if body["primary_model"] != "gpt-5.5" {
		t.Fatalf("primary_model = %v", body["primary_model"])
	}
	if body["primary_provider"] != "proxy-gpt" {
		t.Fatalf("primary_provider = %v", body["primary_provider"])
	}
	if body["embedding_base_url"] != "https://embed.example/v1" {
		t.Fatalf("embedding_base_url = %v", body["embedding_base_url"])
	}

	models, ok := body["models"].([]map[string]interface{})
	if !ok || len(models) != 1 {
		t.Fatalf("models = %#v, want one entry", body["models"])
	}
	if models[0]["id"] != "gpt-5.5" {
		t.Fatalf("models[0].id = %v", models[0]["id"])
	}
}

func TestDesktopConfigHandler_RequiresAuth(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{}
	handler := desktopConfigHandler(cfg, &stubModelsLister{})

	req := httptest.NewRequest(http.MethodGet, "/api/desktop/config", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestDesktopConfigHandler_OKWithUser(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{}
	cfg.UpdateLLM(testLLMConfig())
	list := &stubModelsLister{
		providers: []store.LLMProvider{{Key: "proxy-gpt", APIType: "openai", Enabled: true}},
		models: []store.LLMModel{{
			ModelID: "gpt-5.5", ProviderKey: "proxy-gpt", DisplayName: "GPT 5.5",
			Enabled: true,
		}},
	}
	handler := desktopConfigHandler(cfg, list)

	req := httptest.NewRequest(http.MethodGet, "/api/desktop/config", nil)
	user := &auth.UserInfo{ID: "u1", Name: "octest", Email: "octest@local.test", Role: "admin"}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed["primary_model"] != "gpt-5.5" {
		t.Fatalf("primary_model = %v", parsed["primary_model"])
	}
}
