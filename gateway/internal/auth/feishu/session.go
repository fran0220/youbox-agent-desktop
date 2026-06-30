package feishu

import (
	"encoding/json"
	"fmt"

	"github.com/markbates/goth"
	"golang.org/x/oauth2"
)

// Session stores data during the OAuth2 auth process with Feishu.
type Session struct {
	AuthURL     string `json:"auth_url"`
	AccessToken string `json:"access_token"`
	Code        string `json:"code"`
}

func (s *Session) GetAuthURL() (string, error) {
	if s.AuthURL == "" {
		return "", fmt.Errorf("missing auth URL")
	}
	return s.AuthURL, nil
}

func (s *Session) Marshal() string {
	b, _ := json.Marshal(s)
	return string(b)
}

// Authorize exchanges the authorization code for an access token.
func (s *Session) Authorize(provider goth.Provider, params goth.Params) (string, error) {
	p := provider.(*Provider)
	code := params.Get("code")
	if code == "" {
		return "", fmt.Errorf("missing code parameter")
	}

	token, err := p.config.Exchange(oauth2.NoContext, code)
	if err != nil {
		return "", fmt.Errorf("token exchange: %w", err)
	}

	s.AccessToken = token.AccessToken
	s.Code = code
	return token.AccessToken, nil
}
