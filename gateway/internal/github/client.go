package github

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

type Client struct {
	mu    sync.RWMutex
	token string
	repo  string // owner/repo
}

func NewClient(token, repo string) *Client {
	return &Client{token: token, repo: repo}
}

func (c *Client) Configured() bool {
	token, repo := c.credentials()
	return token != "" && repo != ""
}

func (c *Client) Update(token, repo string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = token
	c.repo = repo
}

func (c *Client) credentials() (string, string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token, c.repo
}

// UploadImage uploads a file to the feedback-assets branch via Contents API.
// It returns the raw.githubusercontent.com URL for embedding into issue markdown.
func (c *Client) UploadImage(path string, content []byte) (string, error) {
	token, repo := c.credentials()
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s", repo, path)
	body := map[string]string{
		"message": fmt.Sprintf("feedback: upload %s", path),
		"content": base64.StdEncoding.EncodeToString(content),
		"branch":  "feedback-assets",
	}

	data, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("github upload marshal: %w", err)
	}

	req, err := http.NewRequest(http.MethodPut, apiURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("github upload build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("github upload: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("github upload %d: %s", resp.StatusCode, string(b))
	}

	rawURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/feedback-assets/%s", repo, path)
	return rawURL, nil
}

// CreateIssue creates a GitHub issue and returns issue number + HTML URL.
func (c *Client) CreateIssue(title, body string, labels []string) (int, string, error) {
	token, repo := c.credentials()
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/issues", repo)
	payload := map[string]interface{}{
		"title":  title,
		"body":   body,
		"labels": labels,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return 0, "", fmt.Errorf("github issue marshal: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(data))
	if err != nil {
		return 0, "", fmt.Errorf("github issue build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, "", fmt.Errorf("github issue: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return 0, "", fmt.Errorf("github issue %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		Number  int    `json:"number"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, "", fmt.Errorf("github issue decode response: %w", err)
	}

	return result.Number, result.HTMLURL, nil
}
