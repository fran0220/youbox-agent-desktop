package feishu

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/markbates/goth"
	"golang.org/x/oauth2"
)

const (
	authorizeURL    = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
	tokenURL        = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
	endpointProfile = "https://open.feishu.cn/open-apis/authen/v1/user_info"
)

// Provider implements goth.Provider for Feishu/Lark OAuth2.
type Provider struct {
	clientID     string
	clientSecret string
	callbackURL  string
	config       *oauth2.Config
	providerName string
}

// New creates a new Feishu OAuth2 provider.
func New(clientID, clientSecret, callbackURL string, scopes ...string) *Provider {
	p := &Provider{
		clientID:     clientID,
		clientSecret: clientSecret,
		callbackURL:  callbackURL,
		providerName: "feishu",
	}
	p.config = &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  callbackURL,
		Endpoint: oauth2.Endpoint{
			AuthURL:  tokenURL,
			TokenURL: tokenURL,
		},
		Scopes: scopes,
	}
	return p
}

func (p *Provider) Name() string               { return p.providerName }
func (p *Provider) SetName(name string)         { p.providerName = name }
func (p *Provider) Debug(bool)                  {}
func (p *Provider) RefreshTokenAvailable() bool { return false }
func (p *Provider) RefreshToken(refreshToken string) (*oauth2.Token, error) {
	return nil, fmt.Errorf("not implemented")
}

// BeginAuth starts the Feishu OAuth2 flow.
// Note: Feishu uses `app_id` instead of `client_id` in the authorize URL.
func (p *Provider) BeginAuth(state string) (goth.Session, error) {
	params := url.Values{
		"app_id":       {p.clientID},
		"redirect_uri": {p.callbackURL},
		"state":        {state},
	}
	authURL := authorizeURL + "?" + params.Encode()
	return &Session{AuthURL: authURL}, nil
}

func (p *Provider) UnmarshalSession(data string) (goth.Session, error) {
	s := &Session{}
	err := json.Unmarshal([]byte(data), s)
	return s, err
}

// FetchUser fetches user info from Feishu using the access token.
func (p *Provider) FetchUser(session goth.Session) (goth.User, error) {
	s := session.(*Session)
	if s.AccessToken == "" {
		return goth.User{}, fmt.Errorf("missing access token")
	}

	req, err := http.NewRequest("GET", endpointProfile, nil)
	if err != nil {
		return goth.User{}, err
	}
	req.Header.Set("Authorization", "Bearer "+s.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return goth.User{}, fmt.Errorf("fetch user info: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return goth.User{}, fmt.Errorf("read response: %w", err)
	}

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			OpenID    string `json:"open_id"`
			UnionID   string `json:"union_id"`
			Name      string `json:"name"`
			Email     string `json:"email"`
			AvatarURL string `json:"avatar_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return goth.User{}, fmt.Errorf("parse user info: %w", err)
	}
	if result.Code != 0 {
		return goth.User{}, fmt.Errorf("feishu API error: %s", result.Msg)
	}

	email := result.Data.Email
	if email == "" {
		email = result.Data.OpenID + "@feishu.local"
	}

	return goth.User{
		Provider:  p.providerName,
		UserID:    result.Data.OpenID,
		Name:      result.Data.Name,
		Email:     email,
		AvatarURL: result.Data.AvatarURL,
		RawData: map[string]interface{}{
			"union_id": result.Data.UnionID,
		},
	}, nil
}
