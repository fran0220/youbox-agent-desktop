package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

type Config struct {
	llmMu             sync.RWMutex `yaml:"-"`
	cliToolsMu        sync.RWMutex `yaml:"-"`
	cliToolsManifest  string       `yaml:"-"`
	Server            ServerConfig `yaml:"server"`
	Auth   AuthConfig   `yaml:"auth"`
	// Keep the legacy key for config-file compatibility during the Pi migration.
	PiVM         PiVMConfig      `yaml:"openclaw"`
	LLM          LLMConfig       `yaml:"llm"`
	Database     DatabaseConfig  `yaml:"database"`
	GitHub       GitHubConfig    `yaml:"github"`
	ChatAgent    ChatAgentConfig `yaml:"chat_agent"`
	PostHog      PostHogConfig   `yaml:"posthog"`
	OcGatewayURL string          `yaml:"oc_gateway_url"`
}

type PiVMConfig struct {
	Image    string `yaml:"image"`
	Port     int    `yaml:"port"`
	HostIP   string `yaml:"host_ip"`
	BasePort int    `yaml:"base_port"`
	DataRoot string `yaml:"data_root"`
}

type GitHubConfig struct {
	Token string `yaml:"token"`
	Repo  string `yaml:"repo"`
}

type ChatAgentConfig struct {
	URL   string `yaml:"url"`
	Token string `yaml:"token"`
}

type PostHogConfig struct {
	APIKey   string `yaml:"api_key"`
	Endpoint string `yaml:"endpoint"`
}

type LLMConfig struct {
	ProxyURL          string `yaml:"proxy_url"`
	ProxyKey          string `yaml:"proxy_key"`
	ExaAPIKey         string `yaml:"exa_api_key"`
	TavilyKey         string `yaml:"tavily_api_key"`
	GrokAPIURL        string `yaml:"grok_api_url"`
	GrokAPIKey        string `yaml:"grok_api_key"`
	GrokModel         string `yaml:"grok_model"`
	OpenAIAPIKey      string `yaml:"openai_api_key"`
	EmbeddingBaseURL  string `yaml:"embedding_base_url"`
	EmbeddingAPIKey   string `yaml:"embedding_api_key"`
	FalAPIKey         string `yaml:"fal_api_key"`
	MineruToken       string `yaml:"mineru_token"`
	JimengAPIURL      string `yaml:"jimeng_api_url"`
	JimengAPIKey      string `yaml:"jimeng_api_key"`
	AssetGatewayToken   string `yaml:"asset_gateway_token"`
	AssetGatewayURL     string `yaml:"asset_gateway_url"`
	AISearchGatewayURL  string `yaml:"ai_search_gateway_url"`
	AISearchToken       string `yaml:"ai_search_token"`
	FeishuAppID       string `yaml:"feishu_app_id"`
	FeishuAppSecret   string `yaml:"feishu_app_secret"`
	PrimaryModel      string `yaml:"primary_model"`
	PrimaryProvider   string `yaml:"primary_provider"`
}

type ServerConfig struct {
	Port      int    `yaml:"port"`
	Host      string `yaml:"host"`
	PublicURL string `yaml:"public_url"`
	StaticDir string `yaml:"static_dir"`
}

type AuthConfig struct {
	AdminToken         string `yaml:"admin_token"`
	FeishuClientID     string `yaml:"feishu_client_id"`
	FeishuClientSecret string `yaml:"feishu_client_secret"`
	SessionTTLHours    int    `yaml:"session_ttl_hours"`
}

type DatabaseConfig struct {
	URL string `yaml:"url"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{}

	data, err := os.ReadFile(path)
	if err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse config: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read config: %w", err)
	}
	// Missing file is OK — env vars provide all values on Railway

	// Defaults
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "0.0.0.0"
	}
	if cfg.Auth.SessionTTLHours == 0 {
		cfg.Auth.SessionTTLHours = 720
	}
	if cfg.PiVM.Port == 0 {
		cfg.PiVM.Port = 18789
	}
	if cfg.PiVM.BasePort == 0 {
		cfg.PiVM.BasePort = 18800
	}
	if cfg.PiVM.Image == "" {
		cfg.PiVM.Image = "pi-ready"
	}
	if cfg.PiVM.DataRoot == "" {
		cfg.PiVM.DataRoot = "/srv/jacoworks/openclaw"
	}

	applyEnvOverrides(cfg)
	if err := validateRequired(cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func validateRequired(cfg *Config) error {
	if strings.TrimSpace(cfg.Database.URL) == "" {
		return fmt.Errorf("database.url is required")
	}

	return nil
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("GATEWAY_SERVER_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = port
		}
	}
	if v := os.Getenv("GATEWAY_SERVER_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("GATEWAY_SERVER_PUBLIC_URL"); v != "" {
		cfg.Server.PublicURL = v
	}
	if v := os.Getenv("GATEWAY_SERVER_STATIC_DIR"); v != "" {
		cfg.Server.StaticDir = v
	}
	if v := os.Getenv("GATEWAY_AUTH_ADMIN_TOKEN"); v != "" {
		cfg.Auth.AdminToken = v
	}
	if v := os.Getenv("GATEWAY_AUTH_FEISHU_CLIENT_ID"); v != "" {
		cfg.Auth.FeishuClientID = v
	}
	if v := os.Getenv("GATEWAY_AUTH_FEISHU_CLIENT_SECRET"); v != "" {
		cfg.Auth.FeishuClientSecret = v
	}
	if v := os.Getenv("GATEWAY_AUTH_SESSION_TTL_HOURS"); v != "" {
		if ttl, err := strconv.Atoi(v); err == nil {
			cfg.Auth.SessionTTLHours = ttl
		}
	}
	if v := os.Getenv("GATEWAY_PIVM_IMAGE"); v != "" {
		cfg.PiVM.Image = v
	} else if v := os.Getenv("GATEWAY_OPENCLAW_IMAGE"); v != "" {
		cfg.PiVM.Image = v
	}
	if v := os.Getenv("GATEWAY_PIVM_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.PiVM.Port = port
		}
	} else if v := os.Getenv("GATEWAY_OPENCLAW_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.PiVM.Port = port
		}
	}
	if v := os.Getenv("GATEWAY_PIVM_HOST_IP"); v != "" {
		cfg.PiVM.HostIP = v
	} else if v := os.Getenv("GATEWAY_OPENCLAW_HOST_IP"); v != "" {
		cfg.PiVM.HostIP = v
	}
	if v := os.Getenv("GATEWAY_PIVM_BASE_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.PiVM.BasePort = port
		}
	} else if v := os.Getenv("GATEWAY_OPENCLAW_BASE_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.PiVM.BasePort = port
		}
	}
	if v := os.Getenv("GATEWAY_PIVM_DATA_ROOT"); v != "" {
		cfg.PiVM.DataRoot = v
	} else if v := os.Getenv("GATEWAY_OPENCLAW_DATA_ROOT"); v != "" {
		cfg.PiVM.DataRoot = v
	}
	if v := os.Getenv("GATEWAY_DATABASE_URL"); v != "" {
		cfg.Database.URL = v
	}
	if v := os.Getenv("GATEWAY_GITHUB_TOKEN"); v != "" {
		cfg.GitHub.Token = v
	}
	if v := os.Getenv("GATEWAY_GITHUB_REPO"); v != "" {
		cfg.GitHub.Repo = v
	}
	if v := os.Getenv("GATEWAY_LLM_PROXY_URL"); v != "" {
		cfg.LLM.ProxyURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_PROXY_KEY"); v != "" {
		cfg.LLM.ProxyKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_EXA_API_KEY"); v != "" {
		cfg.LLM.ExaAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_TAVILY_API_KEY"); v != "" {
		cfg.LLM.TavilyKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_GROK_API_URL"); v != "" {
		cfg.LLM.GrokAPIURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_GROK_API_KEY"); v != "" {
		cfg.LLM.GrokAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_GROK_MODEL"); v != "" {
		cfg.LLM.GrokModel = v
	}
	if v := os.Getenv("GATEWAY_LLM_OPENAI_API_KEY"); v != "" {
		cfg.LLM.OpenAIAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_FAL_API_KEY"); v != "" {
		cfg.LLM.FalAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_MINERU_TOKEN"); v != "" {
		cfg.LLM.MineruToken = v
	}
	if v := os.Getenv("GATEWAY_LLM_JIMENG_API_URL"); v != "" {
		cfg.LLM.JimengAPIURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_JIMENG_API_KEY"); v != "" {
		cfg.LLM.JimengAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_ASSET_GATEWAY_TOKEN"); v != "" {
		cfg.LLM.AssetGatewayToken = v
	}
	if v := os.Getenv("GATEWAY_LLM_ASSET_GATEWAY_URL"); v != "" {
		cfg.LLM.AssetGatewayURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_AI_SEARCH_GATEWAY_URL"); v != "" {
		cfg.LLM.AISearchGatewayURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_AI_SEARCH_TOKEN"); v != "" {
		cfg.LLM.AISearchToken = v
	}
	if v := os.Getenv("GATEWAY_LLM_PRIMARY_MODEL"); v != "" {
		cfg.LLM.PrimaryModel = v
	}
	if v := os.Getenv("GATEWAY_LLM_PRIMARY_PROVIDER"); v != "" {
		cfg.LLM.PrimaryProvider = v
	}
	if v := os.Getenv("GATEWAY_CHAT_AGENT_URL"); v != "" {
		cfg.ChatAgent.URL = v
	}
	if v := os.Getenv("GATEWAY_CHAT_AGENT_TOKEN"); v != "" {
		cfg.ChatAgent.Token = v
	}
	if v := os.Getenv("GATEWAY_POSTHOG_API_KEY"); v != "" {
		cfg.PostHog.APIKey = v
	}
	if v := os.Getenv("GATEWAY_POSTHOG_ENDPOINT"); v != "" {
		cfg.PostHog.Endpoint = v
	}
	if v := os.Getenv("GATEWAY_OC_GATEWAY_URL"); v != "" {
		cfg.OcGatewayURL = v
	}
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}

func (c *Config) GetLLM() LLMConfig {
	c.llmMu.RLock()
	defer c.llmMu.RUnlock()
	return c.LLM
}

func (c *Config) UpdateLLM(llm LLMConfig) {
	c.llmMu.Lock()
	defer c.llmMu.Unlock()
	c.LLM = llm
}

func (c *Config) GetCliToolsManifest() string {
	c.cliToolsMu.RLock()
	defer c.cliToolsMu.RUnlock()
	return c.cliToolsManifest
}

func (c *Config) SetCliToolsManifest(manifest string) {
	c.cliToolsMu.Lock()
	defer c.cliToolsMu.Unlock()
	c.cliToolsManifest = manifest
}
