package main

import (
	"context"
	"encoding/json"

	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

// agentConfigModelsLister loads enabled models for agent/desktop config responses.
type agentConfigModelsLister interface {
	ListProviders(ctx context.Context) ([]store.LLMProvider, error)
	ListModels(ctx context.Context) ([]store.LLMModel, error)
}

func buildAgentModels(ctx context.Context, s agentConfigModelsLister) []map[string]interface{} {
	var models []map[string]interface{}
	providers, _ := s.ListProviders(ctx)
	dbModels, _ := s.ListModels(ctx)

	providerAPITypes := make(map[string]string)
	for _, p := range providers {
		if p.Enabled {
			providerAPITypes[p.Key] = p.APIType
		}
	}

	for _, m := range dbModels {
		if !m.Enabled {
			continue
		}
		if _, ok := providerAPITypes[m.ProviderKey]; !ok {
			continue
		}
		models = append(models, map[string]interface{}{
			"id":             m.ModelID,
			"provider":       m.ProviderKey,
			"label":          m.DisplayName,
			"context_window": m.ContextWindow,
			"max_tokens":     m.MaxTokens,
			"reasoning":      m.Reasoning,
			"api_type":       providerAPITypes[m.ProviderKey],
		})
	}
	return models
}

func parseToolsManifest(cfg *config.Config) interface{} {
	var toolsManifest interface{}
	if raw := cfg.GetCliToolsManifest(); raw != "" {
		if err := json.Unmarshal([]byte(raw), &toolsManifest); err != nil {
			toolsManifest = nil
		}
	}
	return toolsManifest
}

// buildAgentConfigResponse is the full agent config payload (includes non-LLM tool secrets).
func buildAgentConfigResponse(ctx context.Context, cfg *config.Config, s agentConfigModelsLister) map[string]interface{} {
	llm := cfg.GetLLM()
	return map[string]interface{}{
		"llm_proxy_url":         llm.ProxyURL,
		"llm_proxy_key":         llm.ProxyKey,
		"openai_api_key":        llm.OpenAIAPIKey,
		"exa_api_key":           llm.ExaAPIKey,
		"tavily_api_key":        llm.TavilyKey,
		"embedding_base_url":    llm.EmbeddingBaseURL,
		"embedding_api_key":     llm.EmbeddingAPIKey,
		"fal_api_key":           llm.FalAPIKey,
		"mineru_token":          llm.MineruToken,
		"jimeng_api_url":        llm.JimengAPIURL,
		"jimeng_api_key":        llm.JimengAPIKey,
		"asset_gateway_token":   llm.AssetGatewayToken,
		"asset_gateway_url":     llm.AssetGatewayURL,
		"ai_search_gateway_url": llm.AISearchGatewayURL,
		"ai_search_token":       llm.AISearchToken,
		"primary_model":         llm.PrimaryModel,
		"primary_provider":      llm.PrimaryProvider,
		"tools_manifest":        parseToolsManifest(cfg),
		"models":                buildAgentModels(ctx, s),
	}
}

// desktopConfigRedactedKeys are omitted from GET /api/desktop/config (non-LLM secrets).
var desktopConfigRedactedKeys = []string{
	"openai_api_key",
	"exa_api_key",
	"tavily_api_key",
	"fal_api_key",
	"mineru_token",
	"jimeng_api_url",
	"jimeng_api_key",
	"asset_gateway_token",
	"asset_gateway_url",
	"ai_search_gateway_url",
	"ai_search_token",
}

// buildDesktopConfigResponse returns LLM fields only for the desktop client.
func buildDesktopConfigResponse(ctx context.Context, cfg *config.Config, s agentConfigModelsLister) map[string]interface{} {
	full := buildAgentConfigResponse(ctx, cfg, s)
	out := map[string]interface{}{
		"llm_proxy_url":      full["llm_proxy_url"],
		"llm_proxy_key":      full["llm_proxy_key"],
		"embedding_base_url": full["embedding_base_url"],
		"embedding_api_key":  full["embedding_api_key"],
		"primary_model":      full["primary_model"],
		"primary_provider":   full["primary_provider"],
		"tools_manifest":     full["tools_manifest"],
		"models":             full["models"],
	}
	return out
}
