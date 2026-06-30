package agent

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
)

const (
	defaultWSTicketTTL      = 30 * time.Second
	wsTicketCleanupInterval = 5 * time.Second
)

var (
	ErrInvalidWSTicket = errors.New("invalid ws ticket")
	ErrExpiredWSTicket = errors.New("expired ws ticket")
)

type TicketStore struct {
	mu      sync.Mutex
	tickets map[string]wsTicket
	ttl     time.Duration

	stopCh    chan struct{}
	doneCh    chan struct{}
	closeOnce sync.Once
}

type wsTicket struct {
	userID    string
	expiresAt time.Time
}

func NewTicketStore(ttl time.Duration) *TicketStore {
	if ttl <= 0 {
		ttl = defaultWSTicketTTL
	}

	store := &TicketStore{
		tickets: make(map[string]wsTicket),
		ttl:     ttl,
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}

	go store.cleanupLoop()
	return store
}

func (s *TicketStore) Close() {
	if s == nil {
		return
	}

	s.closeOnce.Do(func() {
		close(s.stopCh)
		<-s.doneCh
	})
}

func (s *TicketStore) CreateTicket(userID string) (string, error) {
	if s == nil {
		return "", fmt.Errorf("ticket store not initialized")
	}

	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", fmt.Errorf("user id is required")
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}

	ticket := hex.EncodeToString(b)

	s.mu.Lock()
	s.tickets[ticket] = wsTicket{
		userID:    userID,
		expiresAt: time.Now().Add(s.ttl),
	}
	s.mu.Unlock()

	return ticket, nil
}

func (s *TicketStore) ValidateTicket(ticket string) (string, error) {
	if s == nil {
		return "", ErrInvalidWSTicket
	}

	ticket = strings.TrimSpace(ticket)
	if ticket == "" {
		return "", ErrInvalidWSTicket
	}

	now := time.Now()

	s.mu.Lock()
	ent, ok := s.tickets[ticket]
	if ok {
		delete(s.tickets, ticket) // single-use token
	}
	s.mu.Unlock()

	if !ok {
		return "", ErrInvalidWSTicket
	}
	if !ent.expiresAt.After(now) {
		return "", ErrExpiredWSTicket
	}

	return ent.userID, nil
}

func (s *TicketStore) IssueTicket(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeWSTicketJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	ticket, err := s.CreateTicket(user.ID)
	if err != nil {
		writeWSTicketJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to issue ticket"})
		return
	}

	writeWSTicketJSON(w, http.StatusOK, map[string]string{
		"ticket": ticket,
	})
}

func (s *TicketStore) cleanupLoop() {
	defer close(s.doneCh)

	ticker := time.NewTicker(wsTicketCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			now := time.Now()
			s.mu.Lock()
			s.cleanupExpiredLocked(now)
			s.mu.Unlock()
		case <-s.stopCh:
			return
		}
	}
}

func (s *TicketStore) cleanupExpiredLocked(now time.Time) {
	for ticket, ent := range s.tickets {
		if !ent.expiresAt.After(now) {
			delete(s.tickets, ticket)
		}
	}
}

func writeWSTicketJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
